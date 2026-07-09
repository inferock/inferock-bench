---
library_name: transformers
tags:
- transformers.js
- tokenizers
license: mit
---

# Claude Tokenizer

A 🤗-compatible version of the **Claude tokenizer** (adapted from [anthropics/anthropic-sdk-python](https://github.com/anthropics/anthropic-sdk-python)). This means it can be used with Hugging Face libraries including [Transformers](https://github.com/huggingface/transformers), [Tokenizers](https://github.com/huggingface/tokenizers), and [Transformers.js](https://github.com/xenova/transformers.js).

## Example usage:

### Transformers/Tokenizers
```py
from transformers import GPT2TokenizerFast

tokenizer = GPT2TokenizerFast.from_pretrained('Xenova/claude-tokenizer')
assert tokenizer.encode('hello world') == [9381, 2253]
```

### Transformers.js
```js
import { AutoTokenizer } from '@xenova/transformers';

const tokenizer = await AutoTokenizer.from_pretrained('Xenova/claude-tokenizer');
const tokens = tokenizer.encode('hello world'); // [9381, 2253]
```