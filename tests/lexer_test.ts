import { assertEquals } from "./deps.ts";
import { TokenType } from "../src/token.ts";
import { Lexer } from "../src/lexer.ts";

Deno.test("lexing single number test", () => {
  const lexer = new Lexer("42");
  lexer.peekToken();
  assertEquals(lexer.nextToken(), { tokenType: "integer", value: "42" });
  lexer.peekToken();
  assertEquals(lexer.nextToken(), { tokenType: "eof", value: "" });
});

Deno.test("lexing number and operator test", () => {
  const src = "12345678910+-*/%";
  const lexer = new Lexer(src);

  let token;

  token = lexer.nextToken();
  assertEquals(token, { tokenType: "integer", value: Number(12345678910).toString() });

  const opes = ["+", "-", "*", "/", "%"];
  for (const ope of opes) {
    token = lexer.nextToken();
    assertEquals(token, { tokenType: ope, value: ope });
  }
});

Deno.test("lexing string literal test", () => {
  const src = '"hoge" "fuga"';
  const lexer = new Lexer(src);

  let token;

  const strings = ['"hoge"', '"fuga"'];
  for (const str of strings) {
    token = lexer.nextToken();
    assertEquals(token, { tokenType: "string", value: str });
  }
});

Deno.test("skip whitespaces test", () => {
  const src = `
1  2 34  5 67
8   910+-
*/%
`;
  const lexer = new Lexer(src);

  let token;

  const nums = [1, 2, 34, 5, 67, 8, 910];
  for (const i of nums) {
    token = lexer.nextToken();
    assertEquals(token, { tokenType: "integer", value: i.toString() });
  }

  const opes = ["+", "-", "*", "/", "%"];
  for (const ope of opes) {
    token = lexer.nextToken();
    assertEquals(token, { tokenType: ope, value: ope });
  }
});

Deno.test("lexing let expression test", () => {
  const src = "let val a = 1, val b = 2 { println_i32(a + b) }"
  const lexer = new Lexer(src);

  const typeAndValues: [TokenType, string][] = [
    ["let", "let"],
    ["val", "val"], ["identifier", "a"], ["=", "="], ["integer", "1"], [",", ","],
    ["val", "val"], ["identifier", "b"], ["=", "="], ["integer", "2"],
    ["{", "{"],
    ["identifier", "println_i32"], ["(", "("], ["identifier", "a"], ["+", "+"], ["identifier", "b"], [")", ")"],
    ["}", "}"]
  ];

  for (const [tokenType, value] of typeAndValues) {
    const token = lexer.nextToken();
    assertEquals(token, { tokenType, value });
  }
});

Deno.test("lexing if expression test", () => {
  const src = "if a == 0 { 42 } else { a }";
  const lexer = new Lexer(src);

  const typeAndValues: [TokenType, string][] = [
    ["if", "if"],
    ["identifier", "a"], ["==", "=="], ["integer", "0"],
    ["{", "{"], ["integer", "42"], ["}", "}"],
    ["else", "else"],
    ["{", "{"], ["identifier", "a"], ["}", "}"]
  ];

  for (const [tokenType, value] of typeAndValues) {
    const token = lexer.nextToken();
    assertEquals(token, { tokenType, value });
  }
});

Deno.test("lexing func definition test", () => {
  const src = `
func main() -> () {
  println_i32(42)
}`;
  const lexer = new Lexer(src);

  const typeAndValues: [TokenType, string][] = [
    ["func", "func"], ["identifier", "main"], ["(", "("], [")", ")"], ["->", "->"], ["(", "("], [")", ")"], ["{", "{"],
    ["identifier", "println_i32"], ["(", "("], ["integer", "42"], [")", ")"],
    ["}", "}"]
  ];

  for (const [tokenType, value] of typeAndValues) {
    const token = lexer.nextToken();
    assertEquals(token, { tokenType, value });
  }
});

Deno.test("lexing val statement test", () => {
  const src = "val answer: i32 = 42;";
  const lexer = new Lexer(src);

  const typeAndValues: [TokenType, string][] = [
    ["val", "val"], ["identifier", "answer"], [":", ":"], ["identifier", "i32"],
    ["=", "="], ["integer", "42"], [";", ";"]
  ];

  for (const [tokenType, value] of typeAndValues) {
    const token = lexer.nextToken();
    assertEquals(token, { tokenType, value });
  }
});

Deno.test("lexing module and symbol :: test", () => {
  const src = `
module deep_thought {
  val answer: i32 = 42;
}

println_i32(deep_thought::answer);
`;
  const lexer = new Lexer(src);

  const typeAndValues: [TokenType, string][] = [
    ["module", "module"], ["identifier", "deep_thought"], ["{", "{"],
    ["val", "val"], ["identifier", "answer"], [":", ":"], ["identifier", "i32"],
    ["=", "="], ["integer", "42"], [";", ";"],
    ["}", "}"],
    ["identifier", "println_i32"], ["(", "("],
    ["identifier", "deep_thought"], ["::", "::"], ["identifier", "answer"],
    [")", ")"], [";", ";"]
  ];

  for (const [tokenType, value] of typeAndValues) {
    const token = lexer.nextToken();
    assertEquals(token, { tokenType, value });
  }
});
