"""LoRA fine-tuning shared by the three train_*.py scripts.

The recipe is the one used for the deployed FinGuide models (paper, Appendix B):

- every training example is a system message (persona, reader level, rules and
  the six BM25 passages) plus the question, and the answer as target;
- the loss is computed on the answer tokens only: the passages are given to the
  model at inference time, so they are masked out of the loss;
- the six passages are reshuffled at every epoch with a deterministic seed, so
  the model does not learn to copy from the first one (the source passage is
  first in 74.2% of the Italian training examples); validation keeps BM25 order;
- the checkpoint with the lowest validation loss is kept.

With --no-passages the six passages are left out of every prompt, in training and
in validation, and the rule to answer only from them is dropped (paper, Table 1:
no-passages-1r and no-passages-3r).

Data are read from the published splits in ../finguide_dataset.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import shutil
import sys
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATASET = HERE.parent / "finguide_dataset"
LANG_DIRS = {"it": "finguide_italian", "en": "finguide_english"}
LEVELS = ("base", "intermediate", "advanced")

# Evaluation every ~half epoch, as in the runs reported in the paper.
EVAL_STEPS = {("it", 3): 225, ("en", 3): 210, ("it", 1): 75, ("en", 1): 70}

# ---------------------------------------------------------------------------
# Prompt: the exact strings of the training records, imperfections included
# ("semplici e esempi"). Changing a single character gives the model a prompt
# it has never seen.
# ---------------------------------------------------------------------------

PERSONA = {
    "it": "Sei un assistente di finanza personale.",
    "en": "You are a personal finance assistant.",
}
LEVEL_INSTRUCTIONS = {
    "it": {
        "base": "L'utente ha conoscenze base di finanza. Usa spiegazioni semplici e esempi pratici. Evita termini tecnici o complessi.",
        "intermediate": "L'utente ha conoscenze di finanza intermedie. Puoi introdurre alcuni termini tecnici, ma sempre accompagnati da una spiegazione.",
        "advanced": "L'utente ha conoscenze avanzate di finanza personale. Evita spiegazioni eccessivamente basilari, puoi usare termini tecnici e spiegazioni più approfondite.",
    },
    "en": {
        "base": "The user has basic financial knowledge. Use simple explanations and practical examples. Avoid technical or complex terms.",
        "intermediate": "The user has intermediate financial knowledge. You may introduce some technical terms, but always with an explanation.",
        "advanced": "The user has advanced knowledge of personal finance. Avoid overly basic explanations; you may use technical terms and give more in-depth explanations.",
    },
}
RULES = {
    "it": "REGOLE: Rispondi SOLO usando i documenti seguenti. Non inventare. Non dare consigli specifici di investimento. Rispondi in italiano in modo conciso.",
    "en": "RULES: Answer ONLY using the documents below. Do not make things up. Do not give specific investment advice. Answer in English, concisely.",
}
RULES_NO_PASSAGES = {
    "it": "REGOLE: Non inventare. Non dare consigli specifici di investimento. Rispondi in italiano in modo conciso.",
    "en": "RULES: Do not make things up. Do not give specific investment advice. Answer in English, concisely.",
}
DOC_LABEL = {"it": "DOCUMENTO", "en": "DOCUMENT"}


def build_messages(lang: str, question: str, docs: list[dict] | None, level: str, answer: str) -> list[dict]:
    """Chat messages of one example; `docs` already in the wanted order, or None
    for a prompt without passages."""
    if docs is None:
        system = f"{PERSONA[lang]} {LEVEL_INSTRUCTIONS[lang][level]}\n\n{RULES_NO_PASSAGES[lang]}"
    else:
        passages = "\n\n".join(f"{DOC_LABEL[lang]} [{d['id']}]:\n{d['text']}" for d in docs)
        system = f"{PERSONA[lang]} {LEVEL_INSTRUCTIONS[lang][level]}\n\n{RULES[lang]}\n\n{passages}"
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": question},
        {"role": "assistant", "content": answer},
    ]


def adapt_for_model(msgs: list[dict], model_id: str) -> list[dict]:
    """SmolLM3's chat template adds a metadata block with today's date to the
    system message; `/system_override` suppresses it, so training and serving
    see the same prompt. Gemma needs nothing."""
    if "smollm" not in model_id.lower():
        return msgs
    out = [dict(m) for m in msgs]
    out[0]["content"] = out[0]["content"].rstrip() + "\n/system_override"
    return out


def load_jsonl(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def check_prompts(lang: str, train: list[dict], passages: dict) -> None:
    """The prompt builder must reproduce the `messages` field of every record."""
    bad = [
        r["pair_id"] for r in train
        if build_messages(lang, r["question"],
                          [{"id": p, "text": passages[p]["text"]} for p in r["doc_ids"]],
                          r["level"], r["answer"]) != r["messages"]
    ]
    if bad:
        raise SystemExit(f"prompt builder does not match {len(bad)} records, e.g. {bad[:5]}")
    print(f"  prompt builder == messages on all {len(train)} records: ok")


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def parse_args(model_id: str) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=f"LoRA fine-tuning of {model_id} on the FinGuide dataset")
    ap.add_argument("--lang", choices=("it", "en"), default="it")
    ap.add_argument("--registers", type=int, choices=(1, 3), default=3,
                    help="3 = basic, intermediate and advanced answers (deployed); "
                         "1 = intermediate answers only")
    ap.add_argument("--no-passages", action="store_true",
                    help="train and validate without the six retrieved passages in the prompt")
    ap.add_argument("--output-dir", type=Path, default=None)
    ap.add_argument("--data-dir", type=Path, default=DATASET)
    ap.add_argument("--model-path", default=None,
                    help="local copy of the base model (default: download it from the Hub)")
    ap.add_argument("--epochs", type=int, default=None,
                    help="default 4 with three registers, 12 with one (same number of steps)")
    ap.add_argument("--lr", type=float, default=5e-5)
    ap.add_argument("--rank", type=int, default=8, help="LoRA rank; alpha is twice the rank")
    ap.add_argument("--dropout", type=float, default=0.05)
    ap.add_argument("--max-len", type=int, default=4096)
    ap.add_argument("--batch", type=int, default=1)
    ap.add_argument("--accum", type=int, default=8)
    ap.add_argument("--eval-steps", type=int, default=None)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--gpu", type=str, default="0")
    ap.add_argument("--dry-run", action="store_true",
                    help="build and check the data, then stop before loading the model")
    args = ap.parse_args()
    args.epochs = args.epochs or (4 if args.registers == 3 else 12)
    args.eval_steps = args.eval_steps or EVAL_STEPS[(args.lang, args.registers)]
    short = model_id.split("/")[-1].lower()
    setting = f"{'no-passages' if args.no_passages else 'passages'}-{args.registers}r"
    args.output_dir = args.output_dir or HERE / f"{short}-{args.lang}-{setting}"
    return args


def main(model_id: str) -> int:
    args = parse_args(model_id)

    # Select the GPU before importing torch: with more than one visible card the
    # Trainer wraps the model in DataParallel.
    os.environ["CUDA_VISIBLE_DEVICES"] = args.gpu
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

    import torch
    import torch.nn.functional as F
    from torch.utils.data import Dataset
    from transformers import (AutoModelForCausalLM, AutoTokenizer, Trainer,
                              TrainerCallback, TrainingArguments)
    from peft import LoraConfig, get_peft_model

    class RecordDataset(Dataset):
        """One record -> input_ids + labels, with the prompt masked (-100).

        Messages are rebuilt at every access because the passage order changes
        with the epoch; with `shuffle=False` they equal the `messages` field.
        With --no-passages no passage is put in the prompt, whatever `doc_ids`
        holds, and every prompt is checked for it."""

        def __init__(self, rows, tok, passages, shuffle, name):
            self.rows, self.tok, self.passages = rows, tok, passages
            self.shuffle, self.name = shuffle, name
            self.epoch = 0
            self.truncated = 0

        def __len__(self):
            return len(self.rows)

        def order(self, r):
            ids = list(r["doc_ids"])
            if self.shuffle:
                # crc32, not hash(): hash() is randomised per process.
                key = f"{args.seed}|{self.epoch}|{r['pair_id']}|{r['level']}".encode()
                random.Random(zlib.crc32(key)).shuffle(ids)
            return ids

        def __getitem__(self, i):
            r = self.rows[i]
            docs = (None if args.no_passages else
                    [{"id": p, "text": self.passages[p]["text"]} for p in self.order(r)])
            msgs = adapt_for_model(
                build_messages(args.lang, r["question"], docs, r["level"], r["answer"]), model_id)
            # Check what actually reaches the model, not the record on disk.
            has_passages = f"{DOC_LABEL[args.lang]} [" in msgs[0]["content"]
            if has_passages == args.no_passages:
                raise RuntimeError(f"{self.name}: passages {'present' if has_passages else 'missing'} "
                                   f"in the prompt ({r['pair_id']}, {r['level']})")
            full = self.tok.apply_chat_template(msgs, tokenize=True, add_generation_prompt=False)
            prompt = self.tok.apply_chat_template(msgs[:-1], tokenize=True, add_generation_prompt=True)
            if full[:len(prompt)] != prompt:
                raise RuntimeError(f"{self.name}: prompt is not a prefix of the record "
                                   f"({r['pair_id']}, {r['level']})")
            if len(full) > args.max_len:
                self.truncated += 1
                full = full[:args.max_len]
            labels = [-100] * min(len(prompt), len(full)) + full[len(prompt):]
            return {"input_ids": full, "labels": labels}

    def collate(batch, pad_id):
        n = max(len(b["input_ids"]) for b in batch)
        return {
            "input_ids": torch.tensor([b["input_ids"] + [pad_id] * (n - len(b["input_ids"])) for b in batch]),
            "labels": torch.tensor([b["labels"] + [-100] * (n - len(b["labels"])) for b in batch]),
            "attention_mask": torch.tensor([[1] * len(b["input_ids"]) + [0] * (n - len(b["input_ids"])) for b in batch]),
        }

    class MaskedLossTrainer(Trainer):
        """Cross-entropy on the answer tokens only. The output head is applied to
        those positions alone, which is what lets a 4,096-token sequence fit in
        memory (Gemma 3 has a 262k-token vocabulary). Same loss as
        `model(..., labels=...)`."""

        def compute_loss(self, model, inputs, return_outputs=False, num_items_in_batch=None):
            base = model.get_base_model() if hasattr(model, "get_base_model") else model
            hidden = base.model(input_ids=inputs["input_ids"],
                                attention_mask=inputs["attention_mask"]).last_hidden_state[:, :-1, :]
            labels = inputs["labels"][:, 1:]
            sel = labels != -100
            logits = base.lm_head(hidden[sel]).float()
            total = F.cross_entropy(logits, labels[sel], reduction="sum")
            loss = total / (num_items_in_batch if num_items_in_batch is not None else sel.sum())
            return (loss, {"loss": loss}) if return_outputs else loss

    class EpochCallback(TrainerCallback):
        """Tells the training set which epoch it is, to reshuffle the passages."""

        def __init__(self, ds):
            self.ds = ds

        def on_epoch_begin(self, targs, state, control, **kw):
            self.ds.epoch = int(state.epoch or 0)

    # --------------------------------------------------------------------- data
    print("=== LOAD DATASET ===")
    data = args.data_dir / LANG_DIRS[args.lang]
    passages = {p["passage_id"]: p for p in load_jsonl(data / "passages.jsonl")}
    train = load_jsonl(data / "train.jsonl")
    val = load_jsonl(data / "validation.jsonl")
    test = load_jsonl(data / "test.jsonl")
    check_prompts(args.lang, train, passages)
    if args.registers == 1:
        train = [r for r in train if r["level"] == "intermediate"]
    # Validation uses the single reference answer, at the intermediate level and in
    # BM25 order (or without passages, with --no-passages). The field is
    # "reference" in Italian and "answer" in English.
    val_rows = [{"pair_id": r["pair_id"], "level": "intermediate", "question": r["question"],
                 "answer": r.get("reference") or r["answer"], "doc_ids": r["doc_ids"]}
                for r in val]
    print(f"  train {len(train)} examples, validation {len(val_rows)}, test {len(test)}")
    print(f"  setting: {'no-passages' if args.no_passages else 'passages'}-{args.registers}r")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(data / "test.jsonl", args.output_dir / "test_holdout.jsonl")
    print(f"  test set saved to {args.output_dir / 'test_holdout.jsonl'}")

    # ------------------------------------------------------- tokenizer and data
    print("\n=== LOAD TOKENIZER ===")
    tok = AutoTokenizer.from_pretrained(args.model_path or model_id)
    tok.padding_side = "right"
    ds_train = RecordDataset(train, tok, passages, shuffle=True, name="train")
    ds_val = RecordDataset(val_rows, tok, passages, shuffle=False, name="validation")
    ex = ds_train[0]
    kept = sum(1 for x in ex["labels"] if x != -100)
    print(f"  first example: {len(ex['input_ids'])} tokens, {kept} in the loss")
    if args.dry_run:
        for i in range(len(ds_train)):
            ds_train[i]
        for i in range(len(ds_val)):
            ds_val[i]
        print(f"  dry run: all examples built, {ds_train.truncated} truncated. Stopping.")
        return 0

    # -------------------------------------------------------------------- model
    print("\n=== LOAD MODEL ===")
    model = AutoModelForCausalLM.from_pretrained(args.model_path or model_id, dtype=torch.bfloat16,
                                                 device_map={"": 0}, attn_implementation="sdpa")
    model.config.use_cache = False
    model = get_peft_model(model, LoraConfig(
        r=args.rank, lora_alpha=2 * args.rank, lora_dropout=args.dropout, task_type="CAUSAL_LM",
        target_modules=["q_proj", "o_proj", "k_proj", "v_proj", "gate_proj", "up_proj", "down_proj"],
    ))
    model.print_trainable_parameters()

    # ----------------------------------------------------------------- training
    print("\n=== LORA FINE-TUNING ===", flush=True)
    targs = TrainingArguments(
        output_dir=str(args.output_dir),
        per_device_train_batch_size=args.batch,
        per_device_eval_batch_size=args.batch,
        gradient_accumulation_steps=args.accum,
        learning_rate=args.lr,
        warmup_ratio=0.0,
        weight_decay=0.0,
        num_train_epochs=args.epochs,
        bf16=True,
        logging_steps=50,
        eval_strategy="steps",
        eval_steps=args.eval_steps,
        save_strategy="steps",
        save_steps=args.eval_steps,
        save_total_limit=2,
        load_best_model_at_end=True,
        metric_for_best_model="eval_val_loss",
        greater_is_better=False,
        seed=args.seed,
        data_seed=args.seed,
        dataloader_num_workers=0,   # the dataset object must see the epoch callback
        remove_unused_columns=False,
        label_names=["labels"],
        prediction_loss_only=True,
        report_to="none",
    )
    trainer = MaskedLossTrainer(
        model=model,
        args=targs,
        train_dataset=ds_train,
        eval_dataset={"val": ds_val},
        data_collator=lambda b: collate(b, tok.pad_token_id),
        callbacks=[EpochCallback(ds_train)],
    )
    trainer.train()

    # ------------------------------------------------------------------- output
    adapter_dir = args.output_dir / "adapter"
    trainer.model.save_pretrained(str(adapter_dir))
    tok.save_pretrained(str(adapter_dir))
    summary = {
        "model": model_id, "lang": args.lang, "registers": args.registers,
        "passages": not args.no_passages,
        "epochs": args.epochs, "lr": args.lr, "rank": args.rank, "alpha": 2 * args.rank,
        "dropout": args.dropout, "max_len": args.max_len, "batch": args.batch,
        "accum": args.accum, "eval_steps": args.eval_steps, "seed": args.seed,
        "n_train": len(ds_train), "n_val": len(ds_val), "truncated": ds_train.truncated,
        "best_checkpoint": trainer.state.best_model_checkpoint,
        "best_eval_val_loss": trainer.state.best_metric,
        "log_history": trainer.state.log_history,
    }
    (args.output_dir / "training_summary.json").write_text(json.dumps(summary, indent=2))
    print(f"\nLoRA adapter saved to {adapter_dir}")
    print(f"best validation loss {trainer.state.best_metric}")
    return 0


if __name__ == "__main__":
    sys.exit("run one of train_smollm3.py, train_gemma3_1b.py, train_gemma3_270m.py")
