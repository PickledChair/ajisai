import { assertEquals } from "https://deno.land/std@0.201.0/assert/mod.ts";
import { Lexer } from "../src/lexer.ts";
import { Parser } from "../src/parser.ts";

Deno.test("parsing integer node test", () => {
  const lexer = new Lexer("42");
  const parser = new Parser(lexer);
  const ast = parser.parseExpr();

  assertEquals(ast, { nodeType: "integer", value: 42 });
});

Deno.test("parsing simple binary node test", () => {
  const lexer = new Lexer("1 + 2");
  const parser = new Parser(lexer);
  const ast = parser.parseExpr();

  assertEquals(
    ast,
    {
      nodeType: "binary", operator: "+",
      left: { nodeType: "integer", value: 1 },
      right: { nodeType: "integer", value: 2 }
    }
  );
});

Deno.test("parsing nested binary node test", () => {
  const lexer = new Lexer("2 * 3 + 4 - 5 / 6 % 7");
  const parser = new Parser(lexer);
  const ast = parser.parseExpr();

  assertEquals(
    ast,
    {
      nodeType: "binary", operator: "-",
      left: {
        nodeType: "binary", operator: "+",
        left: {
          nodeType: "binary", operator: "*",
          left: { nodeType: "integer", value: 2 },
          right: { nodeType: "integer", value: 3 }
        },
        right: { nodeType: "integer", value: 4 }
      },
      right: {
        nodeType: "binary", operator: "%",
        left: {
          nodeType: "binary", operator: "/",
          left: { nodeType: "integer", value: 5 },
          right: { nodeType: "integer", value: 6 }
        },
        right: { nodeType: "integer", value: 7 }
      }
    }
  );
});

Deno.test("parsing grouped binary node test", () => {
  const lexer = new Lexer("2 * (3 + 4) - 5 / (6 % 7)");
  const parser = new Parser(lexer);
  const ast = parser.parseExpr();

  assertEquals(
    ast,
    {
      nodeType: "binary", operator: "-",
      left: {
        nodeType: "binary", operator: "*",
        left: { nodeType: "integer", value: 2 },
        right: {
          nodeType: "binary", operator: "+",
          left: { nodeType: "integer", value: 3 },
          right: { nodeType: "integer", value: 4 },
        }
      },
      right: {
        nodeType: "binary", operator: "/",
        left: { nodeType: "integer", value: 5 },
        right: {
          nodeType: "binary", operator: "%",
          left: { nodeType: "integer", value: 6 },
          right: { nodeType: "integer", value: 7 }
        }
      }
    }
  );
});

Deno.test("parsing let expression test", () => {
  const lexer = new Lexer("let a = 1, b = 2 { a + b }");
  const parser = new Parser(lexer);
  const ast = parser.parseExpr();

  assertEquals(
    ast,
    {
      nodeType: "let",
      declares: [
        {
          nodeType: "declare",
          name: "a",
          value: { nodeType: "integer", value: 1 }
        },
        {
          nodeType: "declare",
          name: "b",
          value: { nodeType: "integer", value: 2 }
        }
      ],
      body: {
        nodeType: "exprSeq",
        exprs: [
          {
            nodeType: "binary", operator: "+",
            left: { nodeType: "variable", name: "a", level: -1, fromEnv: -1, toEnv: -1 },
            right: { nodeType: "variable", name: "b", level: -1, fromEnv: -1, toEnv: -1 }
          }
        ]
      },
      envId: -1
    }
  );
});

Deno.test("parsing if expression test", () => {
  const lexer = new Lexer("if a == 0 { 42 } else { a }");
  const parser = new Parser(lexer);
  const ast = parser.parseExpr();

  assertEquals(
    ast,
    {
      nodeType: "if",
      cond: {
        nodeType: "binary", operator: "==",
        left: { nodeType: "variable", name: "a", level: -1, fromEnv: -1, toEnv: -1 },
        right: { nodeType: "integer", value: 0 }
      },
      then: { nodeType: "exprSeq", exprs: [{ nodeType: "integer", value: 42 }] },
      else: { nodeType: "exprSeq", exprs: [{ nodeType: "variable", name: "a", level: -1, fromEnv: -1, toEnv: -1 }] }
    }
  );
});

Deno.test("parsing proc definition test", () => {
  const lexer = new Lexer("proc add(a: i32, b: i32) -> i32 { a + b }");
  const parser = new Parser(lexer);
  const ast = parser.parse();

  assertEquals(
    ast,
    {
      nodeType: "module",
      defs: [
        {
          nodeType: "def",
          declare: {
            nodeType: "declare",
            name: "add",
            ty: {
              tyKind: "proc",
              procKind: "userdef",
              argTypes: [
                {
                  tyKind: "primitive",
                  name: "i32",
                },
                {
                  tyKind: "primitive",
                  name: "i32",
                },
              ],
              bodyType: {
                tyKind: "primitive",
                name: "i32",
              }
            },
            value: {
              nodeType: "proc",
              args: [
                { nodeType: "procArg", name: "a", ty: { tyKind: "primitive", name: "i32" } },
                { nodeType: "procArg", name: "b", ty: { tyKind: "primitive", name: "i32" } }
              ],
              body: {
                nodeType: "exprSeq",
                exprs: [
                  {
                    nodeType: "binary", operator: "+",
                    left: { nodeType: "variable", name: "a", level: -1, fromEnv: -1, toEnv: -1 },
                    right: { nodeType: "variable", name: "b", level: -1, fromEnv: -1, toEnv: -1 }
                  }
                ]
              },
              envId: -1
            }
          }
        }
      ]
    }
  );
});

Deno.test("parsing call expression test", () => {
  const lexer = new Lexer("println_i32(1 + 2)");
  const parser = new Parser(lexer);
  const ast = parser.parseExpr();

  assertEquals(
    ast,
    {
      nodeType: "call",
      callee: { nodeType: "variable", name: "println_i32", level: -1, fromEnv: -1, toEnv: -1 },
      args: [
        {
          nodeType: "binary", operator: "+",
          left: { nodeType: "integer", value: 1 },
          right: { nodeType: "integer", value: 2 }
        }
      ]
    }
  );
});

Deno.test("parsing empty main proc test", () => {
  const lexer = new Lexer("proc main() { () }");
  const parser = new Parser(lexer);
  const ast = parser.parse();

  assertEquals(
    ast,
    {
      nodeType: "module",
      defs: [
        {
          nodeType: "def",
          declare: {
            nodeType: "declare",
            name: "main",
            ty: {
              tyKind: "proc",
              procKind: "userdef",
              argTypes: [],
              bodyType: {
                tyKind: "primitive",
                name: "()"
              }
            },
            value: {
              nodeType: "proc",
              args: [],
              body: { nodeType: "exprSeq", exprs: [{ nodeType: "unit" }] },
              envId: -1
            }
          }
        }
      ]
    }
  );
});

Deno.test("parsing proc definition (with expression sequence) test", () => {
  const lexer = new Lexer("proc add_with_display(a: i32, b: i32) -> i32 { println_i32(a + b); a + b }");
  const parser = new Parser(lexer);
  const ast = parser.parse();

  assertEquals(
    ast,
    {
      nodeType: "module",
      defs: [
        {
          nodeType: "def",
          declare: {
            nodeType: "declare",
            name: "add_with_display",
            ty: {
              tyKind: "proc",
              procKind: "userdef",
              argTypes: [
                {
                  tyKind: "primitive",
                  name: "i32",
                },
                {
                  tyKind: "primitive",
                  name: "i32",
                },
              ],
              bodyType: {
                tyKind: "primitive",
                name: "i32",
              }
            },
            value: {
              nodeType: "proc",
              args: [
                { nodeType: "procArg", name: "a", ty: { tyKind: "primitive", name: "i32" } },
                { nodeType: "procArg", name: "b", ty: { tyKind: "primitive", name: "i32" } }
              ],
              body: {
                nodeType: "exprSeq",
                exprs: [
                  {
                    nodeType: "call",
                    callee: { nodeType: "variable", name: "println_i32", level: -1, fromEnv: -1, toEnv: -1 },
                    args: [
                      {
                        nodeType: "binary", operator: "+",
                        left: { nodeType: "variable", name: "a", level: -1, fromEnv: -1, toEnv: -1 },
                        right: { nodeType: "variable", name: "b", level: -1, fromEnv: -1, toEnv: -1 }
                      }
                    ]
                  },
                  {
                    nodeType: "binary", operator: "+",
                    left: { nodeType: "variable", name: "a", level: -1, fromEnv: -1, toEnv: -1 },
                    right: { nodeType: "variable", name: "b", level: -1, fromEnv: -1, toEnv: -1 }
                  }
                ]
              },
              envId: -1
            }
          }
        }
      ]
    }
  );
});
