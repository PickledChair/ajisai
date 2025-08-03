import Foundation

public enum AjisaiLexerError: Error, Equatable {
    case reachEof
    case invalidCharacter(srcURL: URL, srcContent: String, pos: String.Index)
    case integerOutOfRange(
        srcURL: URL, srcContent: String, pos: String.Index, end: String.Index)
    case unclosedStringLiteral(
        srcURL: URL, srcContent: String, pos: String.Index, end: String.Index)
    case stringLiteralContainsNewline(
        srcURL: URL, srcContent: String, pos: String.Index, end: String.Index)
    case unreachable
}

public typealias LexerResult<T> = Result<T, AjisaiLexerError>

public struct AjisaiSpan: Equatable, Sendable {
    let start: String.Index
    let end: String.Index
    let srcURL: URL
    let srcContent: String

    public func merge(with other: Self) -> Self? {
        guard srcURL == other.srcURL else {
            return nil
        }
        let newStart = start < other.start ? start : other.start
        let newEnd = other.end < end ? end : other.end
        return AjisaiSpan(start: newStart, end: newEnd, srcURL: srcURL, srcContent: srcContent)
    }
}

public final class AjisaiLexer {
    private let srcContent: String
    public let srcURL: URL
    private var curPos: String.Index
    private var peek: AjisaiToken? = nil
    private var peekError: AjisaiLexerError? = nil
    private var peekStart: String.Index
    private var peekEnd: String.Index

    public init(srcURL: URL, srcContent: String) {
        self.srcURL = srcURL
        self.srcContent = srcContent
        curPos = srcContent.startIndex
        peekStart = srcContent.startIndex
        peekEnd = srcContent.startIndex
    }

    func nextChar() -> Character? {
        guard curPos != srcContent.endIndex else {
            return nil
        }
        let ch = srcContent[curPos]
        curPos = srcContent.index(after: curPos)
        return ch
    }

    func peekChar() -> Character? {
        guard curPos != srcContent.endIndex else {
            peekError = .reachEof
            return nil
        }
        return srcContent[curPos]
    }

    func readNumber(firstCh: Character) -> LexerResult<AjisaiToken> {
        let startPos = curPos
        var chars = [firstCh]
        var next = peekChar()

        while let next1 = next {
            if next1.isNumber && next1.isASCII {
                chars.append(next1)
                _ = nextChar()
            } else {
                break
            }
            next = peekChar()
        }

        if let value = UInt(String(chars)) {
            return .success(.integer(value))
        } else {
            return .failure(
                .integerOutOfRange(
                    srcURL: srcURL, srcContent: srcContent, pos: startPos,
                    end: curPos))
        }
    }

    func stringLiteralEnd() -> LexerResult<String.Index> {
        let startPos = srcContent.index(before: curPos)
        var prevChar: Character = "\0"

        while true {
            guard let ch = nextChar() else {
                return .failure(
                    .unclosedStringLiteral(
                        srcURL: srcURL, srcContent: srcContent, pos: startPos, end: curPos))
            }
            guard ch != "\r" && ch != "\n" else {
                return .failure(
                    .stringLiteralContainsNewline(
                        srcURL: srcURL, srcContent: srcContent, pos: startPos, end: curPos))
            }
            if ch == "\"" && prevChar != "\\" {
                return .success(curPos)
            }
            prevChar = ch
        }
    }

    func readStringLiteral() -> LexerResult<AjisaiToken> {
        // let startPos = srcContent.index(before: curPos)
        let contentStartPos = curPos
        return stringLiteralEnd().map { endPos in
            let contentEndPos = srcContent.index(before: endPos)
            // TODO: エスケープシーケンスの処理
            return .str(String(srcContent[contentStartPos..<contentEndPos]))
        }
    }

    func isIdent1(_ ch: Character) -> Bool {
        return "a"..."z" ~= ch || "A"..."Z" ~= ch || ch == "_"
    }

    func isIdent2(_ ch: Character) -> Bool {
        return isIdent1(ch) || "0"..."9" ~= ch
    }

    func identToToken<T: StringProtocol>(str: T) -> AjisaiToken {
        switch str {
        case "true":
            return .tru
        case "false":
            return .fals
        case "and":
            return .logand
        case "as":
            return .as_
        case "else":
            return .els
        case "do":
            return .do_
        case "fn":
            return .fn
        case "func":
            return .func_
        case "if":
            return .if_
        case "import":
            return .import_
        case "let":
            return .let_
        case "module":
            return .module
        case "not":
            return .not
        case "or":
            return .logor
        case "struct":
            return .struct_
        case "val":
            return .val
        default:
            return .ident(String(str))
        }
    }

    func isPunct(_ ch: Character) -> Bool {
        return [
            "+", "-", "*", "/", "%", "=", "!", "<", ">", ",", ":", ";", /*"&", "|",*/ "(", ")",
            "{", "}", "\"",
        ].contains(ch)
    }

    func readPunct(firstCh: Character) -> LexerResult<AjisaiToken> {
        switch firstCh {
        case "+":
            return .success(.plus)
        case "-":
            if let ch = peekChar() {
                if ch == ">" {
                    _ = nextChar()
                    return .success(.arrow)
                }
            }
            return .success(.minus)
        case "*":
            return .success(.star)
        case "/":
            return .success(.slash)
        case "%":
            return .success(.percent)
        case "=":
            if let ch = peekChar() {
                if ch == "=" {
                    _ = nextChar()
                    return .success(.eq)
                }
            }
            return .success(.assign)
        case "!":
            if let ch = peekChar() {
                if ch == "=" {
                    _ = nextChar()
                    return .success(.neq)
                }
            }
            return .success(.bang)
        case "<":
            if let ch = peekChar() {
                if ch == "=" {
                    _ = nextChar()
                    return .success(.le)
                }
            }
            return .success(.lt)
        case ">":
            if let ch = peekChar() {
                if ch == "=" {
                    _ = nextChar()
                    return .success(.ge)
                }
            }
            return .success(.gt)
        case ",":
            return .success(.comma)
        case ":":
            if let ch = peekChar() {
                if ch == ":" {
                    _ = nextChar()
                    return .success(.colon_colon)
                }
            }
            return .success(.colon)
        case ";":
            return .success(.semicolon)
        // case "&":
        //     if let ch = peekChar() {
        //         if ch == "&" {
        //             _ = nextChar()
        //             return .success(.logand)
        //         }
        //     }
        //     return .failure(
        //         .invalidCharacter(
        //             srcURL: srcURL, srcContent: srcContent, pos: srcContent.index(before: curPos))
        //     )
        // case "|":
        //     if let ch = peekChar() {
        //         if ch == "|" {
        //             _ = nextChar()
        //             return .success(.logor)
        //         }
        //     }
        //     return .failure(
        //         .invalidCharacter(
        //             srcURL: srcURL, srcContent: srcContent, pos: srcContent.index(before: curPos))
        //     )
        case "(":
            return .success(.lparen)
        case ")":
            return .success(.rparen)
        case "{":
            return .success(.lbrace)
        case "}":
            return .success(.rbrace)
        default:
            return .failure(.unreachable)
        }
    }

    func nextTokenImpl() -> LexerResult<AjisaiToken> {
        nextTokenLoop: while true {
            guard let ch = nextChar() else {
                return .failure(.reachEof)
            }

            if ch.isWhitespace && ch.isASCII {
                continue nextTokenLoop
            }

            // comment
            if ch == "/" {
                if let ch1 = peekChar() {
                    if ch1 == "/" {
                        _ = nextChar()
                        while let ch2 = nextChar() {
                            if ch2 == "\n" {
                                continue nextTokenLoop
                            }
                        }
                    }
                }
            }

            if ch.isNumber && ch.isASCII {
                return readNumber(firstCh: ch)
            }

            if ch == "\"" {
                return readStringLiteral()
            }

            if isIdent1(ch) {
                let startPos = srcContent.index(before: curPos)
                var endPos = curPos
                while let ch1 = peekChar() {
                    if !isIdent2(ch1) {
                        break
                    }
                    _ = nextChar()
                    endPos = curPos
                }
                return .success(identToToken(str: srcContent[startPos..<endPos]))
            }

            if isPunct(ch) {
                return readPunct(firstCh: ch)
            }

            return .failure(
                .invalidCharacter(
                    srcURL: srcURL, srcContent: srcContent, pos: curPos))
        }
    }

    public func nextToken() -> LexerResult<(token: AjisaiToken, span: AjisaiSpan)> {
        // peek が nil の時、peekError も nil なら Lexer の初期状態なので nextTokenImpl を実行する
        // peekError が非 nil のときは初期状態ではなくエラー状態なので、そのエラーを戻り値とする
        let curTokenAndSpan: Result<(token: AjisaiToken, span: AjisaiSpan), AjisaiLexerError>
        if peek == nil {
            if peekError == nil {
                let startPos = curPos
                let result = nextTokenImpl()
                let endPos = curPos
                curTokenAndSpan = result.map { token in
                    (
                        token,
                        AjisaiSpan(
                            start: startPos, end: endPos, srcURL: srcURL, srcContent: srcContent)
                    )
                }
            } else {
                curTokenAndSpan = .failure(peekError!)
            }
        } else {
            curTokenAndSpan = .success(
                (
                    peek!,
                    AjisaiSpan(
                        start: peekStart, end: peekEnd, srcURL: srcURL, srcContent: srcContent)
                ))
        }

        // 次の peekToken 呼び出しのための準備
        peekStart = curPos

        switch nextTokenImpl() {
        case .success(let token):
            peek = token
            peekError = nil
        case .failure(let error):
            peek = nil
            peekError = error
        }

        peekEnd = curPos

        return curTokenAndSpan
    }

    public func peekToken() -> LexerResult<(token: AjisaiToken, span: AjisaiSpan)> {
        // peek と peekError の両方が nil のときは Lexer の初期状態なので、
        // 必要な状態に充足する（一方が非 nil ならもう一方は nil）
        if peek == nil && peekError == nil {
            peekStart = curPos

            switch nextTokenImpl() {
            case .success(let token):
                peek = token
                peekError = nil
            case .failure(let error):
                peek = nil
                peekError = error
            }

            peekEnd = curPos
        }
        return peek == nil
            ? .failure(peekError!)
            : .success(
                (
                    peek!,
                    AjisaiSpan(
                        start: peekStart, end: peekEnd, srcURL: srcURL, srcContent: srcContent)
                ))
    }
}
