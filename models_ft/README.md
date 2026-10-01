# Fine-Tuning Scripts

This folder contains the LoRA fine-tuning scripts used to train the three Small Language Models (SLMs) of **FinGuide**. Each model is adapted to answer personal-finance questions from six retrieved passages, at the reader's level of financial knowledge (basic, intermediate or advanced), in Italian or English.

---

## 📄 Files

| Script | Base Model | Parameters |
|---|---|---|
| `train_smollm3.py` | [HuggingFaceTB/SmolLM3-3B](https://huggingface.co/HuggingFaceTB/SmolLM3-3B) | 3B |
| `train_gemma3_1b.py` | [google/gemma-3-1b-it](https://huggingface.co/google/gemma-3-1b-it) | 1B |
| `train_gemma3_270m.py` | [google/gemma-3-270m-it](https://huggingface.co/google/gemma-3-270m-it) | 270M |
| `finetune.py` | training code shared by the three scripts | |

The scripts read the published splits in [`../finguide_dataset`](../finguide_dataset):

| Language | Train | Validation | Test | Passages |
|---|---|---|---|---|
| Italian (CONSOB) | 3,591 (1,197 questions × 3 levels) | 256 | 174 | 522 |
| English (FCA, Bank of England) | 3,405 (1,135 questions × 3 levels) | 230 | 155 | 455 |

---

## ⚙️ Training Configuration

All three models share the same configuration:

| Parameter | Value |
|---|---|
| Method | LoRA (Low-Rank Adaptation) |
| LoRA rank `r` | 8 |
| `lora_alpha` | 16 |
| `lora_dropout` | 0.05 |
| LoRA target modules | `q_proj`, `k_proj`, `v_proj`, `o_proj`, `gate_proj`, `up_proj`, `down_proj` |
| Learning rate | 5e-5, linear decay, no warm-up |
| Optimizer | AdamW |
| Per-device batch size | 1 |
| Gradient accumulation steps | 8 (effective batch = 8) |
| Epochs | 4 (three levels), 12 (one level) |
| Max sequence length | 4,096 tokens |
| Precision | `bfloat16` |
| Seed | 42 |

A few details matter for reproducing the deployed models:

- **Prompt.** Each example is the system message (assistant role, reader level, rules and the six BM25 passages), the question, and the answer, rendered with the chat template of the base model. For SmolLM3 the system message ends with `/system_override`, so the template does not insert today's date.
- **Loss on the answer only.** Prompt tokens are masked, so the model is not trained to reproduce the passages it is given at inference time.
- **Passage order.** The six passages are reshuffled at every epoch with a fixed seed; validation keeps the retrieval order.
- **Checkpoint selection.** Validation loss is evaluated about every half epoch, on the intermediate-level reference answers, and the best checkpoint is kept.

The four training settings of the paper are selected with two options:

| Setting | Passages in the prompt | Levels | Command |
|---|---|---|---|
| no-passages-1r | no | intermediate only | `--registers 1 --no-passages` |
| passages-1r | yes | intermediate only | `--registers 1` |
| no-passages-3r | no | basic, intermediate, advanced | `--no-passages` |
| passages-3r (deployed) | yes | basic, intermediate, advanced | *(default)* |

Without passages the prompt keeps the assistant role, the reader level and the rules, minus the instruction to answer only from the documents; validation is run without passages too.

Main options (`python train_gemma3_1b.py --help` for all of them):

| Option | Default | |
|---|---|---|
| `--lang` | `it` | `it` or `en` |
| `--registers` | `3` | `3` = basic, intermediate and advanced answers (deployed models); `1` = intermediate answers only |
| `--no-passages` | off | leave the six passages out of the prompt |
| `--output-dir` | `./<model>-<lang>-<setting>` | where the adapter is saved |
| `--model-path` | Hugging Face Hub | local copy of the base model |
| `--dry-run` | off | build and check every example, then stop before training |

The deployed models were trained on a single NVIDIA L40S GPU.

---

## 🛠️ Requirements

```bash
pip install transformers trl peft datasets torch
```

---

## 🚀 Usage

```bash
python train_smollm3.py
python train_gemma3_1b.py
python train_gemma3_270m.py
```

Each script will:

1. Load the base model and tokenizer
2. Prepare and split the dataset (75 / 15 / 10)
3. Save `test_holdout.jsonl`
4. Apply the chat template and run LoRA fine-tuning
5. Save LoRA adapters to a local output directory

---

## 💾 Output & Deployment

Each run writes to its output directory:

- `adapter/`: the LoRA adapter and the tokenizer
- `test_holdout.jsonl`: the test split
- `training_summary.json`: configuration, best checkpoint and loss history

For deployment the adapter is merged into the base model and converted to GGUF, at 8-bit (`Q8_0`) and 4-bit (`Q4_K_M`), for on-device inference with `llama.rn`. The deployed models are on Hugging Face, one repository per model and language, each holding the LoRA adapter and both GGUF files:

| Model | Italian | English |
|---|---|---|
| SmolLM3 3B | [Stee201/lira-smollm3-3b-ita-sipar-3reg](https://huggingface.co/Stee201/lira-smollm3-3b-ita-sipar-3reg) | [Stee201/lira-smollm3-3b-ing-sipar-3reg](https://huggingface.co/Stee201/lira-smollm3-3b-ing-sipar-3reg) |
| Gemma 3 1B | [Stee201/lira-gemma3-1b-ita-sipar-3reg](https://huggingface.co/Stee201/lira-gemma3-1b-ita-sipar-3reg) | [Stee201/lira-gemma3-1b-ing-sipar-3reg](https://huggingface.co/Stee201/lira-gemma3-1b-ing-sipar-3reg) |
| Gemma 3 270M | [Stee201/lira-gemma3-270m-ita-sipar-3reg](https://huggingface.co/Stee201/lira-gemma3-270m-ita-sipar-3reg) | [Stee201/lira-gemma3-270m-ing-sipar-3reg](https://huggingface.co/Stee201/lira-gemma3-270m-ing-sipar-3reg) |

---

## 🔗 Related

See the [main project README](../README.md) for full architecture details, app installation instructions, and citation information.
