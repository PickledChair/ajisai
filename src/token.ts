export type TokenType =
  "+" | "-" | "*" | "/" | "%" | "=" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "&&" | "||" | "!"
  | "," | ":" | ";" | "|" | "(" | ")" | "{" | "}"
  | "->"
  | "true" | "false"
  | "else" | "if" | "let" | "func" | "val"
  | "identifier" | "integer" | "string"
  | "eof";

type MutableToken = { tokenType: TokenType, value: string };
export type Token = Readonly<MutableToken>;

export const printToken = (token: Token) => console.log(`Token { tokenType: ${token.tokenType}, value: ${token.value} }`);

export type Keyword = Extract<TokenType, (typeof keywords)[number]>;
const keywords = ["true", "false", "else", "if", "let", "func", "val"] as const;

export const isKeyword = (s: string): Keyword | null => (keywords as Readonly<string[]>).includes(s) ? s as Keyword : null;
