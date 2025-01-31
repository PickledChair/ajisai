import AjisaiParser
import Foundation
import Testing

struct AjisaiLexerTest {
    func lexingTestTemplate(src: String, expected: [AjisaiToken]) {
        var expected1: [Result<AjisaiToken, AjisaiLexerError>] = expected.map { token in
            .success(token)
        }
        expected1.append(.failure(.reachEof))
        let lexer = AjisaiLexer(srcURL: URL(filePath: "."), srcContent: src)
        let gotTokens = (0..<expected1.count).map { _ in
            lexer.nextToken().map { tokenAndSpan in tokenAndSpan.token }
        }
        #expect(expected1 == gotTokens)
    }

    @Test("lexing an integer test")
    func lexingAnIntegerTest() {
        lexingTestTemplate(src: "42", expected: [.integer(42)])
    }

    @Test("lexing symbols test")
    func lexingSymbolsTest() {
        lexingTestTemplate(src: "+-*/%", expected: [.plus, .minus, .star, .slash, .percent])
    }

    @Test("lexing symbols with whitespaces test")
    func lexingSymbolsWithWhitespacesTest() {
        lexingTestTemplate(
            src: """
                + -	*
                / %
                """,
            expected: [.plus, .minus, .star, .slash, .percent]
        )
    }

    @Test("lexing binary expression test")
    func lexingBinaryExprTest() {
        lexingTestTemplate(src: "12+34", expected: [.integer(12), .plus, .integer(34)])
    }

    @Test("lexing string literal test")
    func lexingStrLiteralTest() {
        lexingTestTemplate(src: "\"hoge\" \"fuga\"", expected: [.str("hoge"), .str("fuga")])
    }

    @Test("lexing let expression test")
    func lexingLetExprTest() {
        lexingTestTemplate(
            src: "let val a = 1, val b = 2 { println_i32(a + b) }",
            expected: [
                .let_, .val, .ident("a"), .assign, .integer(1), .comma, .val,
                .ident("b"), .assign, .integer(2), .lbrace, .ident("println_i32"), .lparen,
                .ident("a"), .plus, .ident("b"), .rparen, .rbrace,
            ]
        )
    }

    @Test("lexing let expression (and skip comment) test")
    func lexingCommentTest() {
        lexingTestTemplate(
            src: """
                // let expression
                let
                    // a value
                    val a = 1
                    // b value
                    val b = 2
                {
                    // print a + b
                    println_i32(a + b)
                }
                """,
            expected: [
                .let_, .val, .ident("a"), .assign, .integer(1), .val,
                .ident("b"), .assign, .integer(2), .lbrace, .ident("println_i32"), .lparen,
                .ident("a"), .plus, .ident("b"), .rparen, .rbrace,
            ]
        )
    }

    @Test("lexing do expression test")
    func lexingDoExprTest() {
        lexingTestTemplate(
            src: "do { 1; 2; 3 }",
            expected: [
                .do_, .lbrace, .integer(1), .semicolon, .integer(2), .semicolon, .integer(3),
                .rbrace,
            ]
        )
    }

    @Test("lexing if expression test")
    func lexingIfExprTest() {
        lexingTestTemplate(
            src: "if a == 0 { 42 } else { a }",
            expected: [
                .if_, .ident("a"), .eq, .integer(0), .lbrace, .integer(42), .rbrace, .els,
                .lbrace,
                .ident("a"), .rbrace,
            ]
        )
    }

    @Test("lexing function definition test")
    func lexingFuncDefTest() {
        lexingTestTemplate(
            src: """
                func main() -> () {
                    println_i32(42)
                }
                """,
            expected: [
                .func_, .ident("main"), .lparen, .rparen, .arrow, .lparen, .rparen, .lbrace,
                .ident("println_i32"), .lparen, .integer(42), .rparen, .rbrace,
            ]
        )
    }

    @Test("lexing variable definition test")
    func lexingVarDefTest() {
        lexingTestTemplate(
            src: "val answer: i32 = 42;",
            expected: [
                .val, .ident("answer"), .colon, .ident("i32"), .assign, .integer(42), .semicolon,
            ]
        )
    }

    @Test("lexing module definition test")
    func lexingModuleDefTest() {
        lexingTestTemplate(
            src: """
                module deep_thought {
                  val answer: i32 = 42;
                }

                import deep_thought;

                println_i32(deep_thought::answer);
                """,
            expected: [
                .module, .ident("deep_thought"), .lbrace, .val, .ident("answer"), .colon,
                .ident("i32"), .assign, .integer(42), .semicolon, .rbrace, .import_,
                .ident("deep_thought"), .semicolon, .ident("println_i32"), .lparen,
                .ident("deep_thought"), .colon_colon, .ident("answer"), .rparen, .semicolon,
            ]
        )
    }

    @Test("token peeking test")
    func tokenPeekingTest() {
        let source = "true;"
        let lexer = AjisaiLexer(srcURL: URL(filePath: "."), srcContent: source)
        let result1 = lexer.peekToken()
        let result2 = lexer.peekToken()

        if case .success(let result1) = result1 {
            if case .success(let result2) = result2 {
                #expect(result1 == result2)
            } else {
                #expect(Bool(false), "result2 is failure (\(result2))")
            }
        } else {
            #expect(Bool(false), "result1 is failure (\(result1))")
        }

        _ = lexer.nextToken()

        let result3 = lexer.peekToken()
        let result4 = lexer.peekToken()

        if case .success(let result3) = result3 {
            if case .success(let result4) = result4 {
                #expect(result3 == result4)
            } else {
                #expect(Bool(false), "result4 is failure (\(result4))")
            }
        } else {
            #expect(Bool(false), "result3 is failure (\(result3))")
        }
    }
}
