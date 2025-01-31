import AjisaiParser
import AjisaiSemanticAnalyzer
import AjisaiUtil
import Foundation
import Testing

struct TypingTest {
    func testTemplate(srcContent: String, testFunc: (AjisaiImportGraphNode<AjisaiModule>) -> Void) {
        let lexer = AjisaiLexer(srcURL: URL(filePath: "hoge.ajs"), srcContent: srcContent)
        let parser = AjisaiParser(lexer: lexer)

        switch parser.parse() {
        case let .failure(error):
            #expect(Bool(false), "error: \(error)")
        case let .success(dec):
            switch semanticAnalyze(modDeclare: dec) {
            case let .failure(error):
                #expect(Bool(false), "error: \(error)")
            case let .success(importGraph):
                testFunc(importGraph)
            }
        }
    }

    func testOneValStmtTemplate(srcContent: String, modItemIdx: Int, expectedType: AjisaiType) {
        testTemplate(srcContent: srcContent) { importGraph in
            let item = importGraph.mod.items[modItemIdx]
            switch item {
            case .exprStmtNode(expr: _):
                #expect(Bool(false), "val statement expected, but got expression statement")
            case .importNode(asName: _):
                #expect(Bool(false), "val statement expected, but got import statement")
            case .variableDeclare(let declare):
                #expect(declare.ty == expectedType)
            }
        }
    }

    @Test("typing `val a: () = ();`")
    func unitVariableTest() {
        testOneValStmtTemplate(srcContent: "val a: () = ();", modItemIdx: 0, expectedType: .unit)
    }

    @Test("typing `val a: bool = true;`")
    func boolVariableTest() {
        testOneValStmtTemplate(
            srcContent: "val a: bool = true;", modItemIdx: 0, expectedType: .bool)
    }

    @Test("typing `val a: i32 = 42;`")
    func i32VariableTest() {
        testOneValStmtTemplate(srcContent: "val a: i32 = 42;", modItemIdx: 0, expectedType: .i32)
    }

    @Test("typing `val a: str = \"hello\";`")
    func strVariableTest() {
        testOneValStmtTemplate(
            srcContent: "val a: str = \"hello\";", modItemIdx: 0, expectedType: .str)
    }

    @Test("typing `func answer() -> i32 { 42 }`")
    func returnI32ValueFuncTest() {
        testOneValStmtTemplate(
            srcContent: "func answer() -> i32 { 42 }", modItemIdx: 0,
            expectedType: .function(kind: .userdef, argTypes: [], bodyType: .i32))
    }

    @Test("typing `func concat(a: str, b: str) -> str { str_concat(a, b) }`")
    func strArgAndStrReturnFuncTest() {
        testOneValStmtTemplate(
            srcContent: "func concat(a: str, b: str) -> str { str_concat(a, b) }", modItemIdx: 0,
            expectedType: .function(kind: .userdef, argTypes: [.str, .str], bodyType: .str))
    }

    @Test("typing `val answer: i32 = let val a = 42 { println_i32(a); a };`")
    func valLetTest() {
        testOneValStmtTemplate(
            srcContent: "val answer: i32 = let val a = 42 { println_i32(a); a };", modItemIdx: 0,
            expectedType: .i32)
    }

    @Test("typing let-bound polymorphism")
    func letPolyI32Test() {
        testOneValStmtTemplate(
            srcContent: """
                val a: i32 =
                    let val a = 42
                        val b = true
                        val c = "Hello!"
                        val d = fn(x) { x }
                    {
                        println_bool(d(b));
                        println(d(c));
                        d(a)
                    };
                """,
            modItemIdx: 0, expectedType: .tvar(AjisaiRef(.link(ty: .i32))))
    }

    @Test(
        "typing let with type signatures such as `let val b: fn(bool) -> bool = fn(x) { x } { ... }`"
    )
    func letWithTypeSignatureTest() {
        testOneValStmtTemplate(
            srcContent: """
                val a: i32 =
                    let val a = 42
                        val b: fn(bool) -> bool = fn(x) { x }
                        func c(x: i32) -> i32 { x }
                    {
                        println_bool(b(true));
                        c(a)
                    };
                """,
            modItemIdx: 0, expectedType: .i32)
    }

    @Test("typing `val b: i32 = if true { 1 } else { 0 };`")
    func ifExprTest() {
        testOneValStmtTemplate(
            srcContent: "val b: i32 = if true { 1 } else { 0 };", modItemIdx: 0, expectedType: .i32)
    }

    @Test("typing `val three: i32 = 1 + 2;`")
    func i32AddTest() {
        testOneValStmtTemplate(
            srcContent: "val three: i32 = 1 + 2;", modItemIdx: 0, expectedType: .i32)
    }

    @Test("typing `val helloworld: str = \"hello\" + \"world\";`")
    func strAddTest() {
        testOneValStmtTemplate(
            srcContent: "val helloworld: str = \"hello\" + \"world\";", modItemIdx: 0,
            expectedType: .str)
    }

    @Test("typing `val a: i32 = ((1 + 2) * (3 - 4)) / 5;`")
    func i32ArithTest() {
        testOneValStmtTemplate(
            srcContent: "val a: i32 = ((1 + 2) * (3 - 4)) / 5;", modItemIdx: 0, expectedType: .i32)
    }

    @Test("typing `val cond: bool = let val a = 5 { 2 < 3 and 4 >= a };`")
    func compareTest1() {
        testOneValStmtTemplate(
            srcContent: "val cond: bool = let val a = 5 { 2 < 3 and 4 >= a };", modItemIdx: 0,
            expectedType: .bool)
    }

    @Test(
        "typing `val cond: bool = 1 != 2 and true == true or \"hello\" != \"world\" and () == ();`")
    func compareTest2() {
        testOneValStmtTemplate(
            srcContent:
                "val cond: bool = 1 != 2 and true == true or \"hello\" != \"world\" and () == ();",
            modItemIdx: 0,
            expectedType: .bool)
    }

    @Test("typing lambda function `fn(a, b) { a + b }`")
    func lambdaInferTest() {
        testOneValStmtTemplate(
            srcContent: """
                val a: i32 =
                    let val add = fn(a, b) { a + b }
                    { add(1, 2) };
                """,
            modItemIdx: 0, expectedType: .add(AjisaiRef(.i32)))
    }

    @Test("typing `val a: i32 = fn(b) { if not b { 10 - -2 } else { -10 + -2 } }(true);`")
    func unaryTest() {
        testOneValStmtTemplate(
            srcContent: "val a: i32 = fn(b) { if not b { 10 - -2 } else { -10 + -2 } }(true);",
            modItemIdx: 0, expectedType: .i32)
    }

    @Test("typing `val a: i32 = 1; val b: i32 = a + 2;`")
    func refPrecedingVarTest() {
        testOneValStmtTemplate(
            srcContent: """
                val a: i32 = 1;
                val b: i32 = a + 2;
                """,
            modItemIdx: 1, expectedType: .i32)
    }

    @Test(
        "typing `func show_add(a: i32, b: i32) { println_i32(add(1, 2)) } func add(a: i32, b: i32) -> i32 { a + b }`"
    )
    func refFollowingFuncTest() {
        testOneValStmtTemplate(
            srcContent: """
                func show_add(a: i32, b: i32) {
                    println_i32(add(1, 2))
                }
                func add(a: i32, b: i32) -> i32 {
                    a + b
                }
                """,
            modItemIdx: 0,
            expectedType: .function(kind: .userdef, argTypes: [.i32, .i32], bodyType: .unit))
    }

    @Test("typing recursive function")
    func recursiveFuncTest() {
        testOneValStmtTemplate(
            srcContent: """
                func fib(n: i32) -> i32 {
                    if n == 0 or n == 1 {
                        1
                    } else {
                        fib(n - 1) + fib(n - 2)
                    }
                }
                """,
            modItemIdx: 0,
            expectedType: .function(kind: .userdef, argTypes: [.i32], bodyType: .i32))
    }

    @Test("typing submodule variable")
    func subModVarTest() {
        testOneValStmtTemplate(
            srcContent: """
                module sub {
                    val a: i32 = 42;
                }
                import sub;
                val b: i32 = -sub::a;
                """,
            modItemIdx: 1,
            expectedType: .i32)
    }
}
