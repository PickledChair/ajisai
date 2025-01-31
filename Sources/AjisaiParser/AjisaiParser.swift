public enum AjisaiParserError: Error, Equatable {
    case invalidElseClause(span: AjisaiSpan)
    case invalidPrimaryToken(got: AjisaiToken, span: AjisaiSpan)
    case letHasNoDeclares(span: AjisaiSpan)
    case lexerError(AjisaiLexerError)
    case unexpectedToken(expected: AjisaiToken, got: AjisaiToken, span: AjisaiSpan)
    case unmatchedBrace(span: AjisaiSpan)
    case declareHasNoTypeSignature(span: AjisaiSpan?)
    case unreachable
}

public typealias ParseResult<T> = Result<T, AjisaiParserError>

public final class AjisaiParser {
    private var lexer: AjisaiLexer

    public init(lexer: AjisaiLexer) {
        self.lexer = lexer
    }

    public func parse() -> ParseResult<AjisaiModuleDeclareNode> {
        let modName = lexer.srcURL.deletingPathExtension().lastPathComponent
        return parseModule(isSubMod: false).map { mod in
            AjisaiModuleDeclareNode(name: modName, mod: mod)
        }
    }

    func parseModule(isSubMod: Bool, startSpan: AjisaiSpan? = nil) -> ParseResult<AjisaiModuleNode>
    {
        var items: [AjisaiModuleItemNode] = []
        var endSpan: AjisaiSpan? = nil

        while true {
            if case .failure(.reachEof) = lexer.peekToken() {
                break
            }

            // module-level variable definition
            if let val = eat(.val) {
                switch parseValDef(startSpan: val.span) {
                case let .success(valDec):
                    endSpan = valDec.span
                    items.append(.valNode(declare: valDec))
                case let .failure(error):
                    return .failure(error)
                }
                continue
            }

            // module-level function definition
            if let func_ = eat(.func_) {
                switch parseFuncDef(startSpan: func_.span) {
                case let .success(funcDef):
                    endSpan = funcDef.span
                    items.append(.funcNode(funcDef: funcDef))
                case let .failure(error):
                    return .failure(error)
                }
                continue
            }

            // module definition
            if let module = eat(.module) {
                switch expect(.ident("")) {
                case let .failure(error):
                    return .failure(error)
                case let .success((token: name, span: nameSpan)):
                    guard case let .ident(name) = name else {
                        return .failure(.unreachable)
                    }

                    if case let .failure(error) = expect(.lbrace) {
                        return .failure(error)
                    }

                    switch parseModule(isSubMod: true) {
                    case let .failure(error):
                        return .failure(error)
                    case let .success(mod):
                        let modSpan = mod.span?.merge(with: nameSpan)
                        endSpan = modSpan
                        items.append(
                            .moduleNode(
                                moduleDeclare: AjisaiModuleDeclareNode(
                                    name: name, mod: mod, span: modSpan),
                                span: modSpan?.merge(with: module.span)))
                    }
                }
                continue
            }

            // closing module definition
            if let rbrace = eat(.rbrace) {
                if isSubMod {
                    endSpan = rbrace.span
                    break
                } else {
                    return .failure(.unmatchedBrace(span: rbrace.span))
                }
            }

            // import statement
            if let import_ = eat(.import_) {
                switch parseImport(startSpan: import_.span) {
                case let .success(importStmt):
                    endSpan = importStmt.span
                    items.append(importStmt)
                case let .failure(error):
                    return .failure(error)
                }
                continue
            }

            // expression statement
            switch parseExpr() {
            case .success(let expr):
                switch expect(.semicolon) {
                case let .failure(error):
                    return .failure(error)
                case let .success(semicolon):
                    items.append(
                        .exprStmtNode(expr: expr, span: expr.span?.merge(with: semicolon.span)))
                    endSpan = semicolon.span
                }
            case .failure(let error):
                return .failure(error)
            }
        }

        return .success(
            AjisaiModuleNode(
                items: items,
                span: startSpan != nil && endSpan != nil ? startSpan!.merge(with: endSpan!) : nil))
    }

    func parseValDef(startSpan: AjisaiSpan) -> ParseResult<AjisaiTypedVariableDeclareNode> {
        parseValDeclare(startSpan: startSpan) {
            (name: String, ty: AjisaiTypeNode?, value: AjisaiExprNode, span: AjisaiSpan?)
                -> ParseResult<AjisaiTypedVariableDeclareNode> in
            if let ty = ty {
                .success(
                    AjisaiTypedVariableDeclareNode(name: name, ty: ty, value: value, span: span))
            } else {
                .failure(.declareHasNoTypeSignature(span: span))
            }
        }.flatMap { valDec in
            expect(.semicolon).map { _ in
                valDec
            }
        }
    }

    func parseImport(startSpan: AjisaiSpan) -> ParseResult<AjisaiModuleItemNode> {
        expect(.ident("")).flatMap {
            guard case let .ident(fstName) = $0.token else {
                return .failure(.unreachable)
            }

            let path: ParseResult<AjisaiPathNode> =
                if eat(.colon_colon) == nil {
                    .success(.pathEnd(name: fstName, span: $0.span))
                } else {
                    parsePath(firstIdent: fstName, startSpan: $0.span)
                }

            switch path {
            case let .failure(error):
                return .failure(error)
            case let .success(path):
                var asName: String? = nil
                let modName = path.lastName()
                // super や package と書いてインポートしている場合、
                // それを本来のモジュール名の代わりにモジュール名として使用する
                if modName == "super" || modName == "package" {
                    asName = modName
                }
                if eat(.as_) != nil {
                    switch expect(.ident("")) {
                    case let .failure(error):
                        return .failure(error)
                    case let .success((token: asNameToken, span: _)):
                        guard case let .ident(asNameValue) = asNameToken else {
                            return .failure(.unreachable)
                        }
                        asName = asNameValue
                    }
                }
                return expect(.semicolon).map {
                    .importNode(path: path, asName: asName, span: startSpan.merge(with: $0.span))
                }
            }
        }
    }

    public func parseExpr() -> ParseResult<AjisaiExprNode> {
        return parseLogOr()
    }

    func parseLogOr() -> ParseResult<AjisaiExprNode> {
        var left: AjisaiExprNode
        switch parseLogAnd() {
        case .success(let expr):
            left = expr
        case .failure(let error):
            return .failure(error)
        }

        while true {
            let ope: AjisaiBinOpKind
            switch lexer.peekToken() {
            case .success(let (token: token, span: _)):
                switch token {
                case .logor:
                    ope = .logor
                default:
                    return .success(left)
                }
            case .failure(let error):
                if error == .reachEof {
                    return .success(left)
                } else {
                    return .failure(.lexerError(error))
                }
            }
            // 上の peekToken のエラー処理があるため、nextToken でエラーになることはない
            _ = lexer.nextToken()

            let right: AjisaiExprNode
            switch parseLogAnd() {
            case .success(let expr):
                right = expr
            case .failure(let error):
                return .failure(error)
            }
            left = .binaryNode(
                opKind: ope, left: left, right: right,
                span: left.span != nil && right.span != nil
                    ? left.span!.merge(with: right.span!) : nil)
        }
    }

    func parseLogAnd() -> ParseResult<AjisaiExprNode> {
        var left: AjisaiExprNode
        switch parseEquality() {
        case .success(let expr):
            left = expr
        case .failure(let error):
            return .failure(error)
        }

        while true {
            let ope: AjisaiBinOpKind
            switch lexer.peekToken() {
            case .success(let (token: token, span: _)):
                switch token {
                case .logand:
                    ope = .logand
                default:
                    return .success(left)
                }
            case .failure(let error):
                if error == .reachEof {
                    return .success(left)
                } else {
                    return .failure(.lexerError(error))
                }
            }
            // 上の peekToken のエラー処理があるため、nextToken でエラーになることはない
            _ = lexer.nextToken()

            let right: AjisaiExprNode
            switch parseEquality() {
            case .success(let expr):
                right = expr
            case .failure(let error):
                return .failure(error)
            }
            left = .binaryNode(
                opKind: ope, left: left, right: right,
                span: left.span != nil && right.span != nil
                    ? left.span!.merge(with: right.span!) : nil)
        }
    }

    func parseEquality() -> ParseResult<AjisaiExprNode> {
        var left: AjisaiExprNode
        switch parseRelational() {
        case .success(let expr):
            left = expr
        case .failure(let error):
            return .failure(error)
        }

        while true {
            let ope: AjisaiBinOpKind
            switch lexer.peekToken() {
            case .success(let (token: token, span: _)):
                switch token {
                case .eq:
                    ope = .eq
                case .neq:
                    ope = .neq
                default:
                    return .success(left)
                }
            case .failure(let error):
                if error == .reachEof {
                    return .success(left)
                } else {
                    return .failure(.lexerError(error))
                }
            }
            // 上の peekToken のエラー処理があるため、nextToken でエラーになることはない
            _ = lexer.nextToken()

            let right: AjisaiExprNode
            switch parseRelational() {
            case .success(let expr):
                right = expr
            case .failure(let error):
                return .failure(error)
            }
            left = .binaryNode(
                opKind: ope, left: left, right: right,
                span: left.span != nil && right.span != nil
                    ? left.span!.merge(with: right.span!) : nil)
        }
    }

    func parseRelational() -> ParseResult<AjisaiExprNode> {
        var left: AjisaiExprNode
        switch parseTerm() {
        case .success(let expr):
            left = expr
        case .failure(let error):
            return .failure(error)
        }

        while true {
            let ope: AjisaiBinOpKind
            switch lexer.peekToken() {
            case .success(let (token: token, span: _)):
                switch token {
                case .lt:
                    ope = .lt
                case .le:
                    ope = .le
                case .gt:
                    ope = .gt
                case .ge:
                    ope = .ge
                default:
                    return .success(left)
                }
            case .failure(let error):
                if error == .reachEof {
                    return .success(left)
                } else {
                    return .failure(.lexerError(error))
                }
            }
            // 上の peekToken のエラー処理があるため、nextToken でエラーになることはない
            _ = lexer.nextToken()

            let right: AjisaiExprNode
            switch parseTerm() {
            case .success(let expr):
                right = expr
            case .failure(let error):
                return .failure(error)
            }
            left = .binaryNode(
                opKind: ope, left: left, right: right,
                span: left.span != nil && right.span != nil
                    ? left.span!.merge(with: right.span!) : nil)
        }
    }

    func parseTerm() -> ParseResult<AjisaiExprNode> {
        var left: AjisaiExprNode
        switch parseFactor() {
        case .success(let expr):
            left = expr
        case .failure(let error):
            return .failure(error)
        }

        while true {
            let ope: AjisaiBinOpKind
            switch lexer.peekToken() {
            case .success(let (token: token, span: _)):
                switch token {
                case .plus:
                    ope = .add
                case .minus:
                    ope = .sub
                default:
                    return .success(left)
                }
            case .failure(let error):
                if error == .reachEof {
                    return .success(left)
                } else {
                    return .failure(.lexerError(error))
                }
            }
            // 上の peekToken のエラー処理があるため、nextToken でエラーになることはない
            _ = lexer.nextToken()

            let right: AjisaiExprNode
            switch parseFactor() {
            case .success(let expr):
                right = expr
            case .failure(let error):
                return .failure(error)
            }
            left = .binaryNode(
                opKind: ope, left: left, right: right,
                span: left.span != nil && right.span != nil
                    ? left.span!.merge(with: right.span!) : nil)
        }
    }

    func parseFactor() -> ParseResult<AjisaiExprNode> {
        var left: AjisaiExprNode
        switch parseUnary() {
        case .success(let expr):
            left = expr
        case .failure(let error):
            return .failure(error)
        }

        while true {
            let ope: AjisaiBinOpKind
            switch lexer.peekToken() {
            case .success(let (token: token, span: _)):
                switch token {
                case .star:
                    ope = .mul
                case .slash:
                    ope = .div
                case .percent:
                    ope = .mod
                default:
                    return .success(left)
                }
            case .failure(let error):
                if error == .reachEof {
                    return .success(left)
                } else {
                    return .failure(.lexerError(error))
                }
            }
            // 上の peekToken のエラー処理があるため、nextToken でエラーになることはない
            _ = lexer.nextToken()

            let right: AjisaiExprNode
            switch parseUnary() {
            case .success(let expr):
                right = expr
            case .failure(let error):
                return .failure(error)
            }
            left = .binaryNode(
                opKind: ope, left: left, right: right,
                span: left.span != nil && right.span != nil
                    ? left.span!.merge(with: right.span!) : nil)
        }
    }

    func parseUnary() -> ParseResult<AjisaiExprNode> {
        var ops: [(AjisaiUnOpKind, AjisaiSpan)] = []

        readOperatorLoop: while true {
            if let minus = eat(.minus) {
                ops.append((.minus, minus.span))
                continue readOperatorLoop
            }

            if let not = eat(.not) {
                ops.append((.neg, not.span))
                continue readOperatorLoop
            }

            break readOperatorLoop
        }

        let operand: AjisaiExprNode
        switch parsePrimary() {
        case .success(let operand1):
            operand = operand1
        case .failure(let error):
            return .failure(error)
        }

        var expr: AjisaiExprNode = operand
        for (op, opSpan) in ops.reversed() {
            expr = .unaryNode(
                opKind: op, operand: expr,
                span: expr.span != nil ? opSpan.merge(with: expr.span!) : nil)
        }
        return .success(expr)
    }

    func parsePrimary() -> ParseResult<AjisaiExprNode> {
        var expr: AjisaiExprNode? = nil

        func processPrimaryCase(
            expected: AjisaiToken,
            proc: (AjisaiToken, AjisaiSpan) -> ParseResult<Void>
        )
            -> Result<Void, AjisaiParserError>
        {
            if let result = eat(expected) {
                let (token, span) = result
                return proc(token, span)
            }
            return .success(())
        }

        let primaryCases: [(AjisaiToken, (AjisaiToken, AjisaiSpan) -> ParseResult<Void>)] = [
            (
                .tru,
                {
                    (_, span) in
                    expr = .boolNode(value: true, span: span)
                    return .success(())
                }
            ),
            (
                .fals,
                {
                    (_, span) in
                    expr = .boolNode(value: false, span: span)
                    return .success(())
                }
            ),
            (
                .integer(0),
                {
                    (token, span) in
                    if case .integer(let value) = token {
                        expr = .integerNode(value: value, span: span)
                        return .success(())
                    }
                    // unreachable here
                    return .failure(.unreachable)
                }
            ),
            (
                .str(""),
                {
                    (token, span) in
                    if case .str(let value) = token {
                        expr = .stringNode(value: value, span: span)
                        return .success(())
                    }
                    // unreachable here
                    return .failure(.unreachable)
                }
            ),
            (
                .lparen,
                {
                    (_, span1) in
                    if let result = self.eat(.rparen) {
                        let (_, span2) = result
                        expr = .unitNode(span: span1.merge(with: span2))
                        return .success(())
                    } else {
                        return self.parseGroup().map { expr1 in
                            expr = expr1
                        }
                    }
                }
            ),
            (
                .ident(""),
                {
                    (token, span) in
                    if case .ident(let name) = token {
                        expr = .variableNode(name: name, span: span)

                        // :: が続く場合、path のパースを行う
                        if self.eat(.colon_colon) != nil {
                            switch self.parsePath(firstIdent: name, startSpan: span) {
                            case let .failure(error):
                                return .failure(error)
                            case let .success(path):
                                expr = .pathNode(path)
                            }
                        }
                        return .success(())
                    }
                    // unreachable here
                    return .failure(.unreachable)
                }
            ),
            (
                .let_,
                {
                    (_, span) in
                    self.parseLet(startSpan: span).map { letExpr in
                        expr = letExpr
                    }
                }
            ),
            (
                .do_,
                {
                    (_, span) in
                    self.expect(.lbrace).flatMap { (_, lbraceSpan) in
                        self.parseExprSeq(startSpan: lbraceSpan).map { exprSeq in
                            expr = .letNode(
                                declares: [], body: exprSeq, span: exprSeq.span?.merge(with: span))
                        }
                    }
                }
            ),
            (
                .if_,
                {
                    (_, span) in
                    self.parseIf(startSpan: span).map { ifExpr in
                        expr = ifExpr
                    }
                }
            ),
            (
                .fn,
                {
                    (_, span) in
                    self.parseFunc(startSpan: span).map { funcExpr in
                        expr = funcExpr
                    }
                }
            ),
        ]

        for (token, proc) in primaryCases {
            if expr != nil {
                break
            }
            if case .failure(let error) = processPrimaryCase(expected: token, proc: proc) {
                return .failure(error)
            }
        }

        guard let expr = expr else {
            switch lexer.peekToken() {
            case let .success((token, span)):
                return .failure(.invalidPrimaryToken(got: token, span: span))
            case let .failure(error):
                return .failure(.lexerError(error))
            }
        }

        return parsePostfix(pre: expr)
    }

    func parseGroup() -> ParseResult<AjisaiExprNode> {
        switch parseExpr() {
        case .success(let expr):
            return expect(.rparen).map { _ in expr }
        case .failure(let error):
            return .failure(error)
        }
    }

    func parsePath(firstIdent: String, startSpan: AjisaiSpan) -> ParseResult<AjisaiPathNode> {
        expect(.ident("")).flatMap {
            guard case let .ident(subName) = $0.token else {
                return .failure(.unreachable)
            }
            var expr: AjisaiPathNode = .path(
                sup: firstIdent, sub: .pathEnd(name: subName, span: $0.span), supSpan: startSpan)
            while eat(.colon_colon) != nil {
                switch expect(.ident("")) {
                case let .failure(error):
                    return .failure(error)
                case let .success((token: token, span: span)):
                    guard case let .ident(subName) = token else {
                        return .failure(.unreachable)
                    }
                    expr = expr.append(path: .pathEnd(name: subName, span: span))
                }
            }
            return .success(expr)
        }
    }

    func parseLet(startSpan: AjisaiSpan) -> ParseResult<AjisaiExprNode> {
        if let lbrace = eat(.lbrace) {
            return .failure(.letHasNoDeclares(span: lbrace.span))
        }

        var declares: [AjisaiLetDeclareNode] = []
        parseDeclareLoop: while true {
            if let val = eat(.val) {
                let valDecResult = parseValDeclare(startSpan: val.span) {
                    (
                        name: String, ty: AjisaiTypeNode?, value: AjisaiExprNode,
                        span: AjisaiSpan?
                    )
                        -> ParseResult<AjisaiVariableDeclareNode> in
                    .success(
                        AjisaiVariableDeclareNode(name: name, ty: ty, value: value, span: span))
                }
                switch valDecResult {
                case let .success(valDec):
                    declares.append(.variableDeclare(declare: valDec))
                    _ = eat(.comma)
                    continue parseDeclareLoop
                case let .failure(error):
                    return .failure(error)
                }
            }
            if let func_ = eat(.func_) {
                switch parseFuncDef(startSpan: func_.span) {
                case let .success(funcDef):
                    declares.append(.funcDeclare(funcDef: funcDef))
                    _ = eat(.comma)
                    continue parseDeclareLoop
                case let .failure(error):
                    return .failure(error)
                }
            }
            break
        }

        return expect(.lbrace).flatMap { (_, lbraceSpan) in
            parseExprSeq(startSpan: lbraceSpan).map { body in
                .letNode(declares: declares, body: body, span: body.span?.merge(with: startSpan))
            }
        }
    }

    func parseValDeclare<T>(
        startSpan: AjisaiSpan,
        convertFn: (String, AjisaiTypeNode?, AjisaiExprNode, AjisaiSpan?) -> ParseResult<T>
    ) -> ParseResult<T> {
        expect(.ident("")).flatMap {
            if case .ident(let varName) = $0.token {
                var ty: AjisaiTypeNode? = nil
                if eat(.colon) != nil {
                    switch parseType() {
                    case .success(let ty1):
                        ty = ty1
                    case .failure(let error):
                        return .failure(error)
                    }
                }

                if case .failure(let error) = expect(.assign) {
                    return .failure(error)
                }

                switch parseExpr() {
                case .success(let value):
                    return convertFn(
                        varName, ty, value,
                        value.span?.merge(with: startSpan))
                case .failure(let error):
                    return .failure(error)
                }
            }
            // unreachable here
            return .failure(.unreachable)
        }
    }

    func parseFuncDef(startSpan: AjisaiSpan) -> ParseResult<AjisaiFuncDefNode> {
        expect(.ident("")).flatMap { identResult in
            let name: AjisaiToken = identResult.token
            guard case let .ident(name) = name else {
                return .failure(.unreachable)
            }

            return parseFunc(startSpan: startSpan).flatMap { funcNode in
                switch funcNode {
                case let .fnExprNode(args: args, body: body, bodyTy: bodyTy, span: span):
                    for arg in args {
                        if arg.ty == nil {
                            return .failure(.declareHasNoTypeSignature(span: arg.span))
                        }
                    }
                    return .success(
                        AjisaiFuncDefNode(
                            name: name,
                            // bodyTy が記述されていなかった場合、unit と解釈する
                            value: .fnExprNode(
                                args: args, body: body, bodyTy: bodyTy ?? .unit, span: span),
                            span: funcNode.span?.merge(with: startSpan)))
                default:
                    return .failure(.unreachable)
                }
            }
        }
    }

    func parseFunc(startSpan: AjisaiSpan) -> ParseResult<AjisaiExprNode> {
        let funcNodeResult: ParseResult<AjisaiExprNode> = expect(.lparen).flatMap { _ in
            var args: [(name: String, ty: AjisaiTypeNode?, span: AjisaiSpan?)] = []
            if eat(.rparen) == nil {
                var alreadyReadRightParen: Bool = false
                while true {
                    switch parseFuncArg() {
                    case let .success(arg):
                        args.append(arg)
                    case let .failure(error):
                        return .failure(error)
                    }
                    if eat(.comma) == nil {
                        break
                    } else {
                        if eat(.rparen) != nil {
                            alreadyReadRightParen = true
                            break
                        }
                    }
                }
                if !alreadyReadRightParen {
                    if case .failure(let error) = expect(.rparen) {
                        return .failure(error)
                    }
                }
            }

            let bodyTy: ParseResult<AjisaiTypeNode?> =
                if eat(.arrow) != nil {
                    switch self.parseType() {
                    case .failure(let error):
                        .failure(error)
                    case .success(let ty):
                        .success(ty)
                    }
                } else {
                    .success(nil)
                }

            switch bodyTy {
            case let .failure(error):
                return .failure(error)
            case let .success(bodyTy):
                return expect(.lbrace).flatMap { (_, lbraceSpan) in
                    parseExprSeq(startSpan: lbraceSpan).map { body in
                        .fnExprNode(
                            args: args, body: body, bodyTy: bodyTy,
                            span: body.span?.merge(with: startSpan))
                    }
                }
            }
        }

        return funcNodeResult
    }

    func parseFuncArg() -> ParseResult<(name: String, ty: AjisaiTypeNode?, span: AjisaiSpan?)> {
        expect(.ident("")).flatMap { identResult in
            guard case let .ident(name) = identResult.token else {
                return .failure(.unreachable)
            }
            return if let colonResult = eat(.colon) {
                parseType().map { ty in
                    (name: name, ty: ty, span: identResult.span.merge(with: colonResult.span))
                }
            } else {
                .success((name: name, ty: nil, span: identResult.span))
            }
        }
    }

    func parseType() -> ParseResult<AjisaiTypeNode> {
        if eat(.lparen) != nil {
            // TODO: 空でないタプルに対応
            if case .failure(let error) = expect(.rparen) {
                return .failure(error)
            }
            return .success(.unit)
        } else if eat(.fn) != nil {
            if case .failure(let error) = expect(.lparen) {
                return .failure(error)
            }

            var argTypes: [AjisaiTypeNode] = []
            if eat(.rparen) == nil {
                var alreadyReadRightParen = false
                while true {
                    switch parseType() {
                    case let .success(argType):
                        argTypes.append(argType)
                    case let .failure(error):
                        return .failure(error)
                    }
                    if eat(.comma) == nil {
                        break
                    } else {
                        if eat(.rparen) != nil {
                            alreadyReadRightParen = true
                            break
                        }
                    }
                }
                if !alreadyReadRightParen {
                    if case .failure(let error) = expect(.rparen) {
                        return .failure(error)
                    }
                }
            }

            // 関数の型の構文は、戻り値の型の明示がない場合は必ず () 型と解釈する
            var bodyType: AjisaiTypeNode = .unit
            if eat(.arrow) != nil {
                switch parseType() {
                case let .success(bodyType1):
                    bodyType = bodyType1
                case let .failure(error):
                    return .failure(error)
                }
            }

            return .success(.function(argTypes: argTypes, bodyType: bodyType))
        } else {
            switch expect(.ident("")) {
            case .failure(let error):
                return .failure(error)
            case let .success((token: token, span: _)):
                if case .ident(let name) = token {
                    if let ty = AjisaiTypeNode.convertToPrimitiveType(from: name) {
                        return .success(ty)
                    } else {
                        // TODO: collection type やユーザー定義型に対応
                    }
                }
                // unreachable here
                return .failure(.unreachable)
            }
        }
    }

    func parseIf(startSpan: AjisaiSpan) -> ParseResult<AjisaiExprNode> {
        parseExpr().flatMap { cond in
            // {
            expect(.lbrace).flatMap { (_, lbraceSpan) in
                parseExprSeq(startSpan: lbraceSpan).flatMap { then in
                    // } else
                    expect(.els).flatMap {
                        // {
                        if let lbrace = eat(.lbrace) {
                            return parseExprSeq(startSpan: lbrace.span).map { els in
                                .ifNode(
                                    cond: cond, then: then, els: els,
                                    span: els.span?.merge(with: startSpan))
                            }
                        } else if let if_ = eat(.if_) {  // } else if ...
                            return parseIf(startSpan: if_.span).map { nextIf in
                                .ifNode(
                                    cond: cond, then: then, els: .exprSeqNode(exprs: [nextIf]),
                                    span: nextIf.span?.merge(with: startSpan))
                            }
                        } else {
                            return .failure(.invalidElseClause(span: $0.span))
                        }
                    }
                }
            }
        }
    }

    func parseExprSeq(startSpan: AjisaiSpan) -> ParseResult<AjisaiExprNode> {
        var exprs: [AjisaiExprNode] = []
        var endSpan = startSpan

        while true {
            switch parseExpr() {
            case .success(let expr):
                exprs.append(expr)
            case .failure(let error):
                return .failure(error)
            }

            if eat(.semicolon) != nil {
                if let rbrace = eat(.rbrace) {
                    exprs.append(.unitNode())
                    endSpan = rbrace.span
                    break
                } else {
                    continue
                }
            } else {
                if case .failure(let error) = expect(.rbrace) {
                    return .failure(error)
                }
                break
            }
        }

        return .success(.exprSeqNode(exprs: exprs, span: startSpan.merge(with: endSpan)))
    }

    func parsePostfix(pre: AjisaiExprNode) -> ParseResult<AjisaiExprNode> {
        var expr = pre
        parsePostLoop: while true {
            if eat(.lparen) != nil {
                switch parseCall(callee: expr) {
                case .success(let call):
                    expr = call
                    continue parsePostLoop
                case .failure(let error):
                    return .failure(error)
                }
            }

            return .success(expr)
        }
    }

    func parseCall(callee: AjisaiExprNode) -> ParseResult<AjisaiExprNode> {
        var args: [AjisaiExprNode] = []

        if let rparen = eat(.rparen) {
            return .success(
                .callNode(callee: callee, args: [], span: callee.span?.merge(with: rparen.span)))
        }

        var rparenSpan: AjisaiSpan? = nil
        while true {
            switch parseExpr() {
            case .success(let expr):
                args.append(expr)
            case .failure(let error):
                return .failure(error)
            }

            if eat(.comma) == nil {
                break
            } else {
                // 最後の引数の後の comma も許可する
                if let rparen = eat(.rparen) {
                    rparenSpan = rparen.span
                    break
                }
            }
        }

        if rparenSpan == nil {
            switch expect(.rparen) {
            case let .failure(error):
                return .failure(error)
            case let .success((token: _, span: span)):
                rparenSpan = span
            }
        }

        return .success(
            .callNode(callee: callee, args: args, span: callee.span?.merge(with: rparenSpan!)))
    }

    func eat(_ token: AjisaiToken) -> (token: AjisaiToken, span: AjisaiSpan)? {
        if case let .success(peeked) = lexer.peekToken() {
            if peeked.token.hasSameTokenKind(to: token) {
                if case .failure(_) = lexer.nextToken() { nil } else { peeked }
            } else {
                nil
            }
        } else {
            nil
        }
    }

    func expect(_ token: AjisaiToken) -> ParseResult<(token: AjisaiToken, span: AjisaiSpan)> {
        lexer.peekToken().mapError { error in
            .lexerError(error)
        }.flatMap { peeked in
            if peeked.token.hasSameTokenKind(to: token) {
                lexer.nextToken().mapError { error in
                    .lexerError(error)
                }.map { _ in peeked }
            } else {
                .failure(
                    .unexpectedToken(expected: token, got: peeked.token, span: peeked.span))
            }
        }
    }
}
