import { assertEquals } from "./deps.ts";
import { Lexer } from "../src/lexer.ts";
import { Parser } from "../src/parser.ts";

Deno.test("parsing integer node test", () => {
  const lexer = new Lexer("42");
  const parser = new Parser(lexer, ".");
  const ast = parser.parseExpr();

  assertEquals(ast, { nodeType: "integer", value: 42 });
});

Deno.test("parsing string node test", () => {
  const lexer = new Lexer('println_str("Hello, world!")');
  const parser = new Parser(lexer, ".");
  const ast = parser.parseExpr();

  assertEquals(
    ast,
    {
      nodeType: "call",
      callee: { nodeType: "localVar", name: "println_str", fromEnv: -1, toEnv: -1 },
      args: [
        { nodeType: "string", value: '"Hello, world!"', len: 0 }
      ]
    }
  );
});

Deno.test("parsing simple binary node test", () => {
  const lexer = new Lexer("1 + 2");
  const parser = new Parser(lexer, ".");
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
  const parser = new Parser(lexer, ".");
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
  const parser = new Parser(lexer, ".");
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
  const lexer = new Lexer("let val a = 1, val b = 2 { a + b }");
  const parser = new Parser(lexer, ".");
  const ast = parser.parseExpr();

  assertEquals(
    ast,
    {
      nodeType: "let",
      declares: [
        {
          nodeType: "declare",
          name: "a",
          ty: undefined,
          value: { nodeType: "integer", value: 1 }
        },
        {
          nodeType: "declare",
          name: "b",
          ty: undefined,
          value: { nodeType: "integer", value: 2 }
        }
      ],
      body: {
        nodeType: "exprSeq",
        exprs: [
          {
            nodeType: "binary", operator: "+",
            left: { nodeType: "localVar", name: "a", fromEnv: -1, toEnv: -1 },
            right: { nodeType: "localVar", name: "b", fromEnv: -1, toEnv: -1 }
          }
        ]
      },
      envId: -1
    }
  );
});

Deno.test("parsing if expression test", () => {
  const lexer = new Lexer("if a == 0 { 42 } else { a }");
  const parser = new Parser(lexer, ".");
  const ast = parser.parseExpr();

  assertEquals(
    ast,
    {
      nodeType: "if",
      cond: {
        nodeType: "binary", operator: "==",
        left: { nodeType: "localVar", name: "a", fromEnv: -1, toEnv: -1 },
        right: { nodeType: "integer", value: 0 }
      },
      then: { nodeType: "exprSeq", exprs: [{ nodeType: "integer", value: 42 }] },
      else: { nodeType: "exprSeq", exprs: [{ nodeType: "localVar", name: "a", fromEnv: -1, toEnv: -1 }] }
    }
  );
});

Deno.test("parsing 'else if' test", () => {
  const lexer = new Lexer("if a == 0 { 42 } else if a == 1 { -1 } else { a }");
  const parser = new Parser(lexer, ".");
  const ast = parser.parseExpr();

  assertEquals(
    ast,
    {
      nodeType: "if",
      cond: {
        nodeType: "binary", operator: "==",
        left: { nodeType: "localVar", name: "a", fromEnv: -1, toEnv: -1 },
        right: { nodeType: "integer", value: 0 }
      },
      then: { nodeType: "exprSeq", exprs: [{ nodeType: "integer", value: 42 }] },
      else: {
        nodeType: "exprSeq", exprs: [
          {
            nodeType: "if",
            cond: {
              nodeType: "binary", operator: "==",
              left: { nodeType: "localVar", name: "a", fromEnv: -1, toEnv: -1 },
              right: { nodeType: "integer", value: 1 }
            },
            then: { nodeType: "exprSeq", exprs: [{ nodeType: "unary", operator: "-", operand: { nodeType: "integer", value: 1 } }] },
            else: { nodeType: "exprSeq", exprs: [{ nodeType: "localVar", name: "a", fromEnv: -1, toEnv: -1 }] }
          }
        ]
      }
    }
  );
});

Deno.test("parsing func definition test", () => {
  const lexer = new Lexer("func add(a: i32, b: i32) -> i32 { a + b }");
  const parser = new Parser(lexer, ".");
  const ast = parser.parse().mod;

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
              tyKind: "func",
              funcKind: "userdef",
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
              nodeType: "func",
              args: [
                { nodeType: "funcArg", name: "a", ty: { tyKind: "primitive", name: "i32" } },
                { nodeType: "funcArg", name: "b", ty: { tyKind: "primitive", name: "i32" } }
              ],
              body: {
                nodeType: "exprSeq",
                exprs: [
                  {
                    nodeType: "binary", operator: "+",
                    left: { nodeType: "localVar", name: "a", fromEnv: -1, toEnv: -1 },
                    right: { nodeType: "localVar", name: "b", fromEnv: -1, toEnv: -1 }
                  }
                ]
              },
              bodyTy: { tyKind: "primitive", name: "i32" },
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
  const parser = new Parser(lexer, ".");
  const ast = parser.parseExpr();

  assertEquals(
    ast,
    {
      nodeType: "call",
      callee: { nodeType: "localVar", name: "println_i32", fromEnv: -1, toEnv: -1 },
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

Deno.test("parsing empty main func test", () => {
  const lexer = new Lexer("func main() { () }");
  const parser = new Parser(lexer, ".");
  const ast = parser.parse().mod;

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
              tyKind: "func",
              funcKind: "userdef",
              argTypes: [],
              bodyType: {
                tyKind: "primitive",
                name: "()"
              }
            },
            value: {
              nodeType: "func",
              args: [],
              body: { nodeType: "exprSeq", exprs: [{ nodeType: "unit" }] },
              bodyTy: { tyKind: "primitive", name: "()" },
              envId: -1
            }
          }
        }
      ]
    }
  );
});

Deno.test("parsing func definition (with expression sequence) test", () => {
  const lexer = new Lexer("func add_with_display(a: i32, b: i32) -> i32 { println_i32(a + b); a + b }");
  const parser = new Parser(lexer, ".");
  const ast = parser.parse().mod;

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
              tyKind: "func",
              funcKind: "userdef",
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
              nodeType: "func",
              args: [
                { nodeType: "funcArg", name: "a", ty: { tyKind: "primitive", name: "i32" } },
                { nodeType: "funcArg", name: "b", ty: { tyKind: "primitive", name: "i32" } }
              ],
              body: {
                nodeType: "exprSeq",
                exprs: [
                  {
                    nodeType: "call",
                    callee: { nodeType: "localVar", name: "println_i32", fromEnv: -1, toEnv: -1 },
                    args: [
                      {
                        nodeType: "binary", operator: "+",
                        left: { nodeType: "localVar", name: "a", fromEnv: -1, toEnv: -1 },
                        right: { nodeType: "localVar", name: "b", fromEnv: -1, toEnv: -1 }
                      }
                    ]
                  },
                  {
                    nodeType: "binary", operator: "+",
                    left: { nodeType: "localVar", name: "a", fromEnv: -1, toEnv: -1 },
                    right: { nodeType: "localVar", name: "b", fromEnv: -1, toEnv: -1 }
                  }
                ]
              },
              bodyTy: { tyKind: "primitive", name: "i32" },
              envId: -1
            }
          }
        }
      ]
    }
  );
});

Deno.test("parsing func expression test", () => {
  const lexer = new Lexer("let val add = func(a: i32, b: i32) -> i32 { a + b } { add(1, 2) }");
  const parser = new Parser(lexer, ".");
  const ast = parser.parseExpr();

  assertEquals(
    ast,
    {
      nodeType: "let",
      declares: [
        {
          nodeType: "declare",
          name: "add",
          ty: undefined,
          value: {
            nodeType: "func",
            args: [
              { nodeType: "funcArg", name: "a", ty: { tyKind: "primitive", name: "i32" } },
              { nodeType: "funcArg", name: "b", ty: { tyKind: "primitive", name: "i32" } }
            ],
            body: {
              nodeType: "exprSeq",
              exprs: [
                {
                  nodeType: "binary",
                  operator: "+",
                  left: { nodeType: "localVar", name: "a", fromEnv: -1, toEnv: -1 },
                  right: { nodeType: "localVar", name: "b", fromEnv: -1, toEnv: -1 }
                }
              ]
            },
            envId: -1,
            bodyTy: { tyKind: "primitive", name: "i32" }
          }
        },
      ],
      body: {
        nodeType: "exprSeq",
        exprs: [
          {
            nodeType: "call",
            callee: { nodeType: "localVar", name: "add", fromEnv: -1, toEnv: -1 },
            args: [
              { nodeType: "integer", value: 1 },
              { nodeType: "integer", value: 2 }
            ]
          }
        ]
      },
      envId: -1
    }
  );
});

Deno.test("parsing func expression (without arguments) test", () => {
  const lexer = new Lexer("let val hello = func() { println_str(\"Hello, world!\") } { hello() }");
  const parser = new Parser(lexer, ".");
  const ast = parser.parseExpr();

  assertEquals(
    ast,
    {
      nodeType: "let",
      declares: [
        {
          nodeType: "declare",
          name: "hello",
          ty: undefined,
          value: {
            nodeType: "func",
            args: [],
            body: {
              nodeType: "exprSeq",
              exprs: [
                {
                  nodeType: "call",
                  callee: { nodeType: "localVar", name: "println_str", fromEnv: -1, toEnv: -1 },
                  args: [{ nodeType: "string", value: '"Hello, world!"', len: 0 }]
                }
              ]
            },
            envId: -1,
            bodyTy: { tyKind: "primitive", name: "()" }
          }
        },
      ],
      body: {
        nodeType: "exprSeq",
        exprs: [
          {
            nodeType: "call",
            callee: { nodeType: "localVar", name: "hello", fromEnv: -1, toEnv: -1 },
            args: []
          }
        ]
      },
      envId: -1
    }
  );
});

Deno.test("parsing immediately invoked function test", () => {
  const lexer = new Lexer("func() { println_str(\"Hello, world!\") }()");
  const parser = new Parser(lexer, ".");
  const ast = parser.parseExpr();

  assertEquals(
    ast,
    {
      nodeType: "call",
      callee: {
        nodeType: "func",
        args: [],
        body: {
          nodeType: "exprSeq",
          exprs: [
            {
              nodeType: "call",
              callee: { nodeType: "localVar", name: "println_str", fromEnv: -1, toEnv: -1 },
              args: [{ nodeType: "string", value: '"Hello, world!"', len: 0 }]
            }
          ]
        },
        envId: -1,
        bodyTy: { tyKind: "primitive", name: "()" }
      },
      args: []
    }
  );
});

Deno.test("parsing val definition test", () => {
  const lexer = new Lexer("val a: i32 = 1 + 2;");
  const parser = new Parser(lexer, ".");
  const ast = parser.parse().mod;

  assertEquals(
    ast,
    {
      nodeType: "module",
      defs: [
        {
          nodeType: "def",
          declare: {
            nodeType: "declare",
            name: "a",
            ty: {
              tyKind: "primitive",
              name: "i32"
            },
            value: {
              nodeType: "binary",
              operator: "+",
                  left: { nodeType: "integer", value: 1 },
                  right: { nodeType: "integer", value: 2 }

            }
          }
        }
      ]
    }
  );
});

Deno.test("parsing empty main func (as val definition) test", () => {
  const lexer = new Lexer("val main: func() = func() { () };");
  const parser = new Parser(lexer, ".");
  const ast = parser.parse().mod;

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
              tyKind: "func",
              funcKind: "userdef",
              argTypes: [],
              bodyType: {
                tyKind: "primitive",
                name: "()"
              }
            },
            value: {
              nodeType: "func",
              args: [],
              body: { nodeType: "exprSeq", exprs: [{ nodeType: "unit" }] },
              bodyTy: { tyKind: "primitive", name: "()" },
              envId: -1
            }
          }
        }
      ]
    }
  );
});

Deno.test("parsing let func declare test", () => {
  const lexer = new Lexer(`
let val hello = "hello "
    val world = "world!"
    func display() { println_str(str_concat(hello, world)) }
{ display() }
`);
  const parser = new Parser(lexer, ".");
  const ast = parser.parseExpr();

  assertEquals(
    ast,
    {
      nodeType: "let",
      declares: [
        {
          nodeType: "declare",
          name: "hello",
          ty: undefined,
          value: { nodeType: "string", value: '"hello "', len: 0 }
        },
        {
          nodeType: "declare",
          name: "world",
          ty: undefined,
          value: { nodeType: "string", value: '"world!"', len: 0 }
        },
        {
          nodeType: "declare",
          name: "display",
          ty: {
            tyKind: "func",
            funcKind: "closure",
            argTypes: [],
            bodyType: { tyKind: "primitive", name: "()" }
          },
          value: {
            nodeType: "func",
            args: [],
            body: {
              nodeType: "exprSeq",
              exprs: [
                {
                  nodeType: "call",
                  callee: { nodeType: "localVar", name: "println_str", fromEnv: -1, toEnv: -1 },
                  args: [
                    {
                      nodeType: "call",
                      callee: { nodeType: "localVar", name: "str_concat", fromEnv: -1, toEnv: -1 },
                      args: [
                        { nodeType: "localVar", name: "hello", fromEnv: -1, toEnv: -1 },
                        { nodeType: "localVar", name: "world", fromEnv: -1, toEnv: -1 }
                      ]
                    }
                  ]
                }
              ]
            },
            envId: -1,
            bodyTy: { tyKind: "primitive", name: "()" }
          }
        },
      ],
      body: {
        nodeType: "exprSeq",
        exprs: [
          {
            nodeType: "call",
            callee: { nodeType: "localVar", name: "display", fromEnv: -1, toEnv: -1 },
            args: []
          }
        ]
      },
      envId: -1
    }
  );
});

Deno.test("parsing submodule test", () => {
  const lexer = new Lexer(`
module deep_thought {
    val answer: i32 = 42;
}
`);
  const parser = new Parser(lexer, ".");
  const ast = parser.parse().mod;

  assertEquals(
    ast,
    {
      nodeType: "module",
      defs: [
        {
          nodeType: "def",
          declare: {
            nodeType: "moduleDeclare",
            name: "deep_thought",
            mod: {
              nodeType: "module",
              defs: [
                {
                  nodeType: "def",
                  declare: {
                    nodeType: "declare",
                    name: "answer",
                    ty: { tyKind: "primitive", name: "i32" },
                    value: { nodeType: "integer", value: 42 }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  );
});

Deno.test("parsing module item access with path syntax test", () => {
  const lexer = new Lexer("!a::b::c::d || false");
  const parser = new Parser(lexer, ".");
  const ast = parser.parseExpr();

  assertEquals(
    ast,
    {
      nodeType: "binary",
      operator: "||",
      left: {
        nodeType: "unary",
        operator: "!",
        operand: {
          nodeType: "path",
          sup: "a",
          sub: {
            nodeType: "path",
            sup: "b",
            sub: {
              nodeType: "path",
              sup:"c",
              sub: { nodeType: "globalVar", name: "d" }
            }
          }
        }
      },
      right: { nodeType: "bool", value: false }
    }
  );
});
