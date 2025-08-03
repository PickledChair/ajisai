import Foundation
import Testing

@testable import AjisaiParser

struct AjisaiParserTest {
    // MARK: - Parsing Statements Test

    func parseStmtTestTemplate(src: String, expected: AjisaiModuleNode) {
        let expected = AjisaiModuleDeclareNode(name: "hoge", mod: expected)
        let lexer = AjisaiLexer(srcURL: URL(filePath: "hoge.ajs"), srcContent: src)
        let parser = AjisaiParser(lexer: lexer)
        #expect(parser.parse() == .success(expected))
    }

    @Test("parsing expression statement test")
    func parsingExprStmtTest() {
        parseStmtTestTemplate(
            src: "true;",
            expected: AjisaiModuleNode(items: [.exprStmtNode(expr: .boolNode(value: true))])
        )
    }

    @Test("parsing function definition test")
    func parsingFuncDefTest() {
        parseStmtTestTemplate(
            src: "func add(a: i32, b: i32) -> i32 { a + b }",
            expected: AjisaiModuleNode(items: [
                .funcNode(
                    funcDef: AjisaiFuncDefNode(
                        name: "add",
                        value: .fnExprNode(
                            args: [
                                (name: "a", ty: .i32, span: nil),
                                (name: "b", ty: .i32, span: nil),
                            ],
                            body: .exprSeqNode(exprs: [
                                .binaryNode(
                                    opKind: .add, left: .variableNode(name: "a"),
                                    right: .variableNode(name: "b"))
                            ]),
                            bodyTy: .i32),
                        span: nil))
            ])
        )
    }

    @Test("parsing empty function definition test")
    func parsingEmptyFuncDefTest() {
        parseStmtTestTemplate(
            src: "func hoge() { () }",
            expected: AjisaiModuleNode(items: [
                .funcNode(
                    funcDef: AjisaiFuncDefNode(
                        name: "hoge",
                        value: .fnExprNode(
                            args: [], body: .exprSeqNode(exprs: [.unitNode()]), bodyTy: .unit)))
            ])
        )
    }

    @Test("parsing expression sequence test")
    func parsingExprSeqTest() {
        parseStmtTestTemplate(
            src: "func add_with_display(a: i32, b: i32) -> i32 { println_i32(a + b); a + b }",
            expected: AjisaiModuleNode(items: [
                .funcNode(
                    funcDef: AjisaiFuncDefNode(
                        name: "add_with_display",
                        value: .fnExprNode(
                            args: [
                                (name: "a", ty: .i32, span: nil),
                                (name: "b", ty: .i32, span: nil),
                            ],
                            body: .exprSeqNode(exprs: [
                                .callNode(
                                    callee: .variableNode(name: "println_i32"),
                                    args: [
                                        .binaryNode(
                                            opKind: .add, left: .variableNode(name: "a"),
                                            right: .variableNode(name: "b"))
                                    ]),
                                .binaryNode(
                                    opKind: .add, left: .variableNode(name: "a"),
                                    right: .variableNode(name: "b")),
                            ]),
                            bodyTy: .i32)))
            ])
        )
    }

    @Test("parsing val definition test")
    func parsingValDefTest() {
        parseStmtTestTemplate(
            src: "val a: i32 = 1 + 2;",
            expected: AjisaiModuleNode(items: [
                .valNode(
                    declare: AjisaiTypedVariableDeclareNode(
                        name: "a", ty: .i32,
                        value: .binaryNode(
                            opKind: .add, left: .integerNode(value: 1),
                            right: .integerNode(value: 2))))
            ])
        )
    }

    @Test("parsing function definition with val test")
    func parsingFuncDefWithValTest() {
        parseStmtTestTemplate(
            src: "val hoge: fn() = fn() { () };",
            expected: AjisaiModuleNode(items: [
                .valNode(
                    declare: AjisaiTypedVariableDeclareNode(
                        name: "hoge",
                        ty: .function(argTypes: [], bodyType: .unit),
                        value: .fnExprNode(args: [], body: .exprSeqNode(exprs: [.unitNode()]))))
            ])
        )
    }

    @Test("parsing module definition test")
    func parsingModuleDefTest() {
        parseStmtTestTemplate(
            src: """
                module deep_thought {
                    val answer: i32 = 42;
                }
                """,
            expected: AjisaiModuleNode(items: [
                .moduleNode(
                    moduleDeclare: AjisaiModuleDeclareNode(
                        name: "deep_thought",
                        mod: AjisaiModuleNode(items: [
                            .valNode(
                                declare: AjisaiTypedVariableDeclareNode(
                                    name: "answer", ty: .i32,
                                    value: .integerNode(value: 42)))
                        ])))
            ])
        )
    }

    @Test("parsing import statemtent test")
    func parsingImportStmtTest() {
        parseStmtTestTemplate(
            src: """
                import a::b::c;
                import d::e::f as hello;
                import a::super;
                import package;
                import a::super as asuper;
                import package as hello;
                """,
            expected: AjisaiModuleNode(items: [
                .importNode(
                    path: .path(sup: "a", sub: .path(sup: "b", sub: .pathEnd(name: "c")))),
                .importNode(
                    path: .path(sup: "d", sub: .path(sup: "e", sub: .pathEnd(name: "f"))),
                    asName: "hello"),
                .importNode(
                    path: .path(sup: "a", sub: .pathEnd(name: "super")), asName: "super"),
                .importNode(path: .pathEnd(name: "package"), asName: "package"),
                .importNode(
                    path: .path(sup: "a", sub: .pathEnd(name: "super")), asName: "asuper"),
                .importNode(path: .pathEnd(name: "package"), asName: "hello"),
            ])
        )
    }

    @Test("parsing struct definition test")
    func parsingStructDefTest() {
        parseStmtTestTemplate(
            src: "struct Hoge { a: i32, b: bool, }",
            expected: AjisaiModuleNode(items: [
                .structDefNode(
                    structDeclare: AjisaiStructDeclareNode(
                        name: "Hoge",
                        fields: [
                            (name: "a", ty: .i32, span: nil), (name: "b", ty: .bool, span: nil),
                        ]))
            ]))
    }

    // MARK: - Parsing Expressions Test

    func parseExprTestTemplate(src: String, expected: AjisaiExprNode) {
        let lexer = AjisaiLexer(srcURL: URL(filePath: "hoge.ajs"), srcContent: src)
        let parser = AjisaiParser(lexer: lexer)
        #expect(parser.parseExpr() == .success(expected))
    }

    @Test("parsing integer test")
    func parsingIntTest() {
        parseExprTestTemplate(src: "42", expected: .integerNode(value: 42))
    }

    @Test("parsing function calling test")
    func parseFuncCallTest() {
        parseExprTestTemplate(
            src: "println_str(\"Hello, world!\")",
            expected: .callNode(
                callee: .variableNode(name: "println_str"),
                args: [.stringNode(value: "Hello, world!")])
        )
        parseExprTestTemplate(
            src: """
                str_concat(
                    "Hello, ",
                    "world!",
                )
                """,
            expected: .callNode(
                callee: .variableNode(name: "str_concat"),
                args: [.stringNode(value: "Hello, "), .stringNode(value: "world!")])
        )
        parseExprTestTemplate(
            src: "println_i32(1 + 2)",
            expected: .callNode(
                callee: .variableNode(name: "println_i32"),
                args: [
                    .binaryNode(
                        opKind: .add, left: .integerNode(value: 1),
                        right: .integerNode(value: 2))
                ])
        )
    }

    @Test("parsing binary expression test")
    func parsingBinExprTest() {
        parseExprTestTemplate(
            src: "1 + 2",
            expected: .binaryNode(
                opKind: .add, left: .integerNode(value: 1), right: .integerNode(value: 2))
        )
        parseExprTestTemplate(
            src: "2 * 3 + 4 - 5 / 6 % 7",
            expected: .binaryNode(
                opKind: .sub,
                left: .binaryNode(
                    opKind: .add,
                    left: .binaryNode(
                        opKind: .mul, left: .integerNode(value: 2),
                        right: .integerNode(value: 3)), right: .integerNode(value: 4)),
                right: .binaryNode(
                    opKind: .mod,
                    left: .binaryNode(
                        opKind: .div, left: .integerNode(value: 5),
                        right: .integerNode(value: 6)), right: .integerNode(value: 7)))
        )
    }

    @Test("parsing grouped binary expression test")
    func parsingGroupedBinExprTest() {
        parseExprTestTemplate(
            src: "2 * (3 + 4) - 5 / (6 % 7)",
            expected: .binaryNode(
                opKind: .sub,
                left: .binaryNode(
                    opKind: .mul, left: .integerNode(value: 2),
                    right: .binaryNode(
                        opKind: .add, left: .integerNode(value: 3),
                        right: .integerNode(value: 4))),
                right: .binaryNode(
                    opKind: .div, left: .integerNode(value: 5),
                    right: .binaryNode(
                        opKind: .mod, left: .integerNode(value: 6),
                        right: .integerNode(value: 7))))
        )
    }

    @Test("parsing let expression test")
    func parsingLetExprTest() {
        parseExprTestTemplate(
            src: "let val a = 1, val b = 2 { a + b }",
            expected: .letNode(
                declares: [
                    .variableDeclare(
                        declare: AjisaiVariableDeclareNode(name: "a", value: .integerNode(value: 1))
                    ),
                    .variableDeclare(
                        declare: AjisaiVariableDeclareNode(name: "b", value: .integerNode(value: 2))
                    ),
                ],
                body: .exprSeqNode(exprs: [
                    .binaryNode(
                        opKind: .add, left: .variableNode(name: "a"),
                        right: .variableNode(name: "b"))
                ]))
        )
    }

    @Test("parsing do expression test")
    func parsingDoExprTest() {
        parseExprTestTemplate(
            src: "do { 1; 2; 3 }",
            expected: .letNode(
                declares: [],
                body: .exprSeqNode(exprs: [
                    .integerNode(value: 1), .integerNode(value: 2), .integerNode(value: 3),
                ]))
        )
    }

    @Test("parsing if expression test")
    func parsingIfExprTest() {
        parseExprTestTemplate(
            src: "if a == 0 { 42 } else { a }",
            expected: .ifNode(
                cond: .binaryNode(
                    opKind: .eq, left: .variableNode(name: "a"), right: .integerNode(value: 0)),
                then: .exprSeqNode(exprs: [.integerNode(value: 42)]),
                els: .exprSeqNode(exprs: [.variableNode(name: "a")]))
        )
    }

    @Test("parsing else if test")
    func parsingElseIfTest() {
        parseExprTestTemplate(
            src: "if a == 0 { 42 } else if a == 1 { -1 } else { a }",
            expected: .ifNode(
                cond: .binaryNode(
                    opKind: .eq, left: .variableNode(name: "a"), right: .integerNode(value: 0)),
                then: .exprSeqNode(exprs: [.integerNode(value: 42)]),
                els: .exprSeqNode(exprs: [
                    .ifNode(
                        cond: .binaryNode(
                            opKind: .eq, left: .variableNode(name: "a"),
                            right: .integerNode(value: 1)),
                        then: .exprSeqNode(exprs: [
                            .unaryNode(opKind: .minus, operand: .integerNode(value: 1))
                        ]),
                        els: .exprSeqNode(exprs: [.variableNode(name: "a")]))
                ]))
        )
    }

    @Test("parsing let with function val test")
    func parsingLetWithFuncValTest() {
        parseExprTestTemplate(
            src: "let val add = fn(a: i32, b: i32) -> i32 { a + b } { add(1, 2) }",
            expected: .letNode(
                declares: [
                    .variableDeclare(
                        declare: AjisaiVariableDeclareNode(
                            name: "add",
                            value: .fnExprNode(
                                args: [
                                    (name: "a", ty: .i32, span: nil),
                                    (name: "b", ty: .i32, span: nil),
                                ],
                                body: .exprSeqNode(exprs: [
                                    .binaryNode(
                                        opKind: .add, left: .variableNode(name: "a"),
                                        right: .variableNode(name: "b"))
                                ]),
                                bodyTy: .i32)))
                ],
                body: .exprSeqNode(exprs: [
                    .callNode(
                        callee: .variableNode(name: "add"),
                        args: [.integerNode(value: 1), .integerNode(value: 2)])
                ]))
        )
        parseExprTestTemplate(
            src: "let val hello = fn() { println_str(\"Hello, world!\") } { hello() }",
            expected: .letNode(
                declares: [
                    .variableDeclare(
                        declare: AjisaiVariableDeclareNode(
                            name: "hello",
                            value: .fnExprNode(
                                args: [],
                                body: .exprSeqNode(exprs: [
                                    .callNode(
                                        callee: .variableNode(name: "println_str"),
                                        args: [.stringNode(value: "Hello, world!")])
                                ]))))
                ],
                body: .exprSeqNode(exprs: [
                    .callNode(callee: .variableNode(name: "hello"), args: [])
                ]))
        )
    }

    @Test("parsing immediately invoked function test")
    func parsingImmediatelyInvokedFuncTest() {
        parseExprTestTemplate(
            src: "fn() { println_str(\"Hello, world!\") }()",
            expected: .callNode(
                callee: .fnExprNode(
                    args: [],
                    body: .exprSeqNode(exprs: [
                        .callNode(
                            callee: .variableNode(name: "println_str"),
                            args: [.stringNode(value: "Hello, world!")])
                    ])), args: [])
        )
    }

    @Test("parsing let with val and func syntax sugar test")
    func parsingLetWithValAndFuncSyntaxSugarTest() {
        parseExprTestTemplate(
            src: """
                let val hello = "hello "
                    val world = "world!"
                    func display() { println_str(str_concat(hello, world)) }
                { display() }
                """,
            expected: .letNode(
                declares: [
                    .variableDeclare(
                        declare: AjisaiVariableDeclareNode(
                            name: "hello", value: .stringNode(value: "hello "))),
                    .variableDeclare(
                        declare: AjisaiVariableDeclareNode(
                            name: "world", value: .stringNode(value: "world!"))),
                    .funcDeclare(
                        funcDef: AjisaiFuncDefNode(
                            name: "display",
                            value: .fnExprNode(
                                args: [],
                                body: .exprSeqNode(exprs: [
                                    .callNode(
                                        callee: .variableNode(name: "println_str"),
                                        args: [
                                            .callNode(
                                                callee: .variableNode(name: "str_concat"),
                                                args: [
                                                    .variableNode(name: "hello"),
                                                    .variableNode(name: "world"),
                                                ])
                                        ])
                                ]),
                                bodyTy: .unit))),
                ],
                body: .exprSeqNode(exprs: [
                    .callNode(callee: .variableNode(name: "display"), args: [])
                ]))
        )
    }

    @Test("parsing path expression test")
    func parsingPathExprTest() {
        parseExprTestTemplate(
            src: "not a::b or false",
            expected: .binaryNode(
                opKind: .logor,
                left: .unaryNode(
                    opKind: .neg,
                    operand: .pathNode(.path(sup: "a", sub: .pathEnd(name: "b")))),
                right: .boolNode(value: false))
        )
    }
}
