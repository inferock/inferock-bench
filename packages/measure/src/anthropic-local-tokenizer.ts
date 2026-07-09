import { Tiktoken } from "js-tiktoken/lite";
import tokenizer from "./vendor/claude-tokenizer/tokenizer.json" with { type: "json" };

export const CLAUDE_TOKENIZER_ESTIMATOR = "Xenova/claude-tokenizer";
export const CLAUDE_TOKENIZER_REVISION = "cae688821ea05490de49a6d3faa36468a4672fad";
export const CLAUDE_TOKENIZER_SOURCE_URL = "https://huggingface.co/Xenova/claude-tokenizer";
export const CLAUDE_TOKENIZER_LICENSE = "MIT";

const GPT2_PATTERN =
  "'s|'t|'re|'ve|'m|'ll|'d| ?\\p{L}+| ?\\p{N}+| ?[^\\s\\p{L}\\p{N}]+|\\s+(?!\\S)|\\s+";
const RANKS_PER_LINE = 1_000;

interface AddedToken {
  readonly id: number;
  readonly special: boolean;
  readonly content: string;
}

interface ClaudeTokenizerJson {
  readonly added_tokens?: readonly AddedToken[];
  readonly model: {
    readonly vocab: Record<string, number>;
  };
}

export interface AnthropicOfflineTokenEstimate {
  readonly tokens: number;
  readonly estimator: typeof CLAUDE_TOKENIZER_ESTIMATOR;
  readonly revision: typeof CLAUDE_TOKENIZER_REVISION;
  readonly sourceUrl: typeof CLAUDE_TOKENIZER_SOURCE_URL;
  readonly license: typeof CLAUDE_TOKENIZER_LICENSE;
  readonly approximate: true;
}

let encoder: Tiktoken | null = null;
let byteDecoder: ReadonlyMap<string, number> | null = null;

export function estimateAnthropicOfflineOutputTokens(
  content: string,
): AnthropicOfflineTokenEstimate {
  return {
    tokens: getClaudeTokenizer().encode(content).length,
    estimator: CLAUDE_TOKENIZER_ESTIMATOR,
    revision: CLAUDE_TOKENIZER_REVISION,
    sourceUrl: CLAUDE_TOKENIZER_SOURCE_URL,
    license: CLAUDE_TOKENIZER_LICENSE,
    approximate: true,
  };
}

function getClaudeTokenizer(): Tiktoken {
  if (encoder) return encoder;
  const parsed = tokenizer as ClaudeTokenizerJson;
  encoder = new Tiktoken({
    pat_str: GPT2_PATTERN,
    special_tokens: specialTokens(parsed.added_tokens ?? []),
    bpe_ranks: bpeRanks(parsed.model.vocab),
  });
  return encoder;
}

function specialTokens(tokens: readonly AddedToken[]): Record<string, number> {
  const output: Record<string, number> = {};
  for (const token of tokens) {
    if (token.special) output[token.content] = token.id;
  }
  return output;
}

function bpeRanks(vocab: Record<string, number>): string {
  const entries = Object.entries(vocab)
    .filter(([token]) => !isSpecialToken(token))
    .map(([token, rank]) => ({
      rank,
      token: tokenBytesBase64(token),
    }))
    .sort((left, right) => left.rank - right.rank);

  const lines: string[] = [];
  for (let index = 0; index < entries.length; index += RANKS_PER_LINE) {
    const chunk = entries.slice(index, index + RANKS_PER_LINE);
    const firstRank = chunk[0]?.rank;
    if (firstRank === undefined) continue;
    lines.push(`! ${firstRank} ${chunk.map((entry) => entry.token).join(" ")}`);
  }
  return lines.join("\n");
}

function isSpecialToken(token: string): boolean {
  return token.startsWith("<") && token.endsWith(">");
}

function tokenBytesBase64(token: string): string {
  const decoder = getByteDecoder();
  const bytes = Array.from(token, (character) => {
    const byte = decoder.get(character);
    if (byte === undefined) {
      throw new Error(`Unsupported Claude tokenizer byte-level character: ${character}`);
    }
    return byte;
  });
  return Buffer.from(bytes).toString("base64");
}

function getByteDecoder(): ReadonlyMap<string, number> {
  if (byteDecoder) return byteDecoder;
  const bytes = [
    ...range(0x21, 0x7e),
    ...range(0xa1, 0xac),
    ...range(0xae, 0xff),
  ];
  const characters = [...bytes];
  let next = 0;
  for (let byte = 0; byte < 256; byte += 1) {
    if (bytes.includes(byte)) continue;
    bytes.push(byte);
    characters.push(256 + next);
    next += 1;
  }

  const decoder = new Map<string, number>();
  for (const [index, byte] of bytes.entries()) {
    decoder.set(String.fromCodePoint(characters[index] ?? 0), byte);
  }
  byteDecoder = decoder;
  return decoder;
}

function range(start: number, end: number): number[] {
  const output: number[] = [];
  for (let value = start; value <= end; value += 1) output.push(value);
  return output;
}
