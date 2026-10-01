"""LoRA fine-tuning of HuggingFaceTB/SmolLM3-3B on the FinGuide dataset (see finetune.py)."""

import sys

from finetune import main

if __name__ == "__main__":
    sys.exit(main("HuggingFaceTB/SmolLM3-3B"))
