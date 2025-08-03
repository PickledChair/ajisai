public enum AjisaiToken: Equatable, Sendable {
    // 記号
    case plus, minus, star, slash  // + - * /
    case percent  // %
    case assign  // =
    case eq, neq, lt, le, gt, ge  // == != < <= > >=
    case comma, colon, colon_colon, semicolon, pipe  // , : :: ; |
    case lparen, rparen, lbrace, rbrace  // ( ) { }
    case arrow  // ->

    // キーワード
    case tru, fals  // true, false
    case as_, do_, els, fn, func_, if_  // as, do, else, fn, func, if
    case import_, let_, module, not, val  // import, let, module, not, val
    case logand, logor, bang  // and or !
    case struct_  // struct

    // リテラル
    case ident(String)  // 識別子
    case integer(UInt)  // 整数値
    case str(String)  // 文字列

    func isKeyword() -> Bool {
        switch self {
        case .tru, .fals, .as_, .els, .if_, .let_, .fn, .func_, .val, .module, .not, .import_:
            return true
        default:
            return false
        }
    }

    public func hasSameTokenKind(to other: AjisaiToken) -> Bool {
        switch (self, other) {
        case (.ident(_), .ident(_)), (.integer(_), .integer(_)), (.str(_), .str(_)):
            return true
        default:
            return self == other
        }
    }
}
