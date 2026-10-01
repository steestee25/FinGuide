"""LoRA fine-tuning of google/gemma-3-1b-it on the FinGuide dataset (see finetune.py)."""

import sys

from finetune import main

if __name__ == "__main__":
    sys.exit(main("google/gemma-3-1b-it"))
