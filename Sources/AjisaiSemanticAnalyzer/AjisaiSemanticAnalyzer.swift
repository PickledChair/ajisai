import AjisaiParser
import AjisaiUtil

public enum AjisaiSemantError: Error {
    case unimplemented, unreachable
    case importGraphError(content: AjisaiImportGraphError)
    case invalidFuncReturnType(expected: String, got: String, span: AjisaiSpan?)
    case typeError(content: TypeError)
    case invalidCalleeType(got: String)
    case variableNotFound(name: String, span: AjisaiSpan?)
    case variableNotInPrecedingDefinitions(name: String, span: AjisaiSpan?)
    case duplicatedVarInLet(name: String, span: AjisaiSpan?)
    case duplicatedVarInFuncParams(name: String, span: AjisaiSpan?)
    case moduleNotFound(name: String, span: AjisaiSpan?)
    case nestedModuleAccess(name: String, span: AjisaiSpan?)
    case modLevelVariableNotFound(name: String, modName: String, span: AjisaiSpan?)
}

public typealias SemantResult<T> = Result<T, AjisaiSemantError>

extension AjisaiRef<UInt> {
    func increment() -> UInt {
        let prev = value
        value += 1
        return prev
    }
}

func makeModEnv(mod: AjisaiModuleNode, envId: UInt, builtins: AjisaiEnv) -> AjisaiEnv {
    let modEnv = AjisaiEnv(envId: envId, envKind: .module, parent: builtins)

    for item in mod.items {
        switch item {
        case .valNode(let declare):
            switch AjisaiType.from(typeNode: declare.ty) {
            case let .function(kind: _, argTypes: argTypes, bodyType: bodyType):
                let funcKind: AjisaiFuncKind =
                    switch declare.value {
                    case .fnExprNode(args: _, body: _, bodyTy: _, span: _):
                        .userdef
                    default:
                        .closure
                    }
                modEnv.addNewVarTy(
                    name: declare.name,
                    ty: .function(kind: funcKind, argTypes: argTypes, bodyType: bodyType))
            case let other:
                modEnv.addNewVarTy(name: declare.name, ty: other)
            }
        case .funcNode(let funcDef):
            switch funcDef.value {
            case let .fnExprNode(args: args, body: _, bodyTy: bodyTy, span: _):
                let argTypes = args.map { arg in AjisaiType.from(typeNode: arg.ty!) }
                let funcTy: AjisaiType = .function(
                    kind: .userdef, argTypes: argTypes,
                    // 構文解析時点で、戻り値の型が省略されたら unit 型を戻り値の型としている
                    bodyType: AjisaiType.from(typeNode: bodyTy!))
                modEnv.addNewVarTy(name: funcDef.name, ty: funcTy)
            default:
                // unreachable
                break
            }
        default:
            break
        }
    }
    return modEnv
}

final class AjisaiSemanticAnalyzer {
    var importGraph: AjisaiImportGraphNode<AjisaiModuleNode>
    var analyzedImportMods: [(name: String, node: AjisaiImportGraphNode<AjisaiModule>)] = []
    var additionalDefs: [AjisaiVariableDeclare] = []
    var inFuncDef = false
    var precedingDefTypeMap: [String: AjisaiType] = [:]

    let closureIdState: AjisaiRef<UInt>
    let globalRootIdState: AjisaiRef<UInt>
    let envIdState: AjisaiRef<UInt>
    let newTVarState: AjisaiRef<UInt> = AjisaiRef(0)

    let modEnv: AjisaiEnv

    var freshClosureId: UInt {
        return closureIdState.increment()
    }

    var freshGlobalRootId: UInt {
        return globalRootIdState.increment()
    }

    var freshEnvId: UInt {
        return envIdState.increment()
    }

    func newTVar(letLevel: UInt) -> AjisaiType {
        return .tvar(AjisaiRef(.unbound(id: newTVarState.increment(), letLevel: letLevel)))
    }

    init(
        importGraph: AjisaiImportGraphNode<AjisaiModuleNode>,
        builtins: AjisaiEnv,
        closureIdState: AjisaiRef<UInt> = AjisaiRef(0),
        globalRootIdState: AjisaiRef<UInt> = AjisaiRef(0),
        // FIXME: builtin 環境の envId が 0 なので 1 から始める
        envIdState: AjisaiRef<UInt> = AjisaiRef(1)
    ) {
        self.importGraph = importGraph
        self.closureIdState = closureIdState
        self.globalRootIdState = globalRootIdState
        self.envIdState = envIdState
        self.modEnv = makeModEnv(
            mod: importGraph.mod, envId: envIdState.increment(), builtins: builtins)
    }

    func analyze() -> SemantResult<AjisaiImportGraphNode<AjisaiModule>> {
        for case let (name: name, node: childGraph) in importGraph.importMods {
            if !childGraph.isAnalyzed {
                let analyzer = AjisaiSemanticAnalyzer(
                    importGraph: childGraph, builtins: modEnv.parent!,
                    closureIdState: closureIdState,
                    globalRootIdState: globalRootIdState, envIdState: envIdState)

                let analyzedGraph = analyzer.analyze()

                switch analyzedGraph {
                case let .failure(error):
                    return .failure(error)
                case let .success(analyzedGraph):
                    analyzedImportMods.append((name: name, node: analyzedGraph))
                }
            }
        }

        return analyzeModule(mod: importGraph.mod, builtins: modEnv.parent!).map { analyzedMod in
            importGraph.isAnalyzed = true

            let analyzedImportGraph: AjisaiImportGraphNode<AjisaiModule> = AjisaiImportGraphNode(
                modName: importGraph.modName, mod: analyzedMod, importerMod: nil)
            analyzedImportGraph.importMods = analyzedImportMods
            // NOTE: 解析結果のグラフノードにはマークしなくても良いかも？
            analyzedImportGraph.isAnalyzed = true
            return analyzedImportGraph
        }
    }

    func analyzeModule(mod: AjisaiModuleNode, builtins: AjisaiEnv) -> SemantResult<AjisaiModule> {
        var items: [AjisaiModuleItem] = []

        for item in mod.items {
            switch item {
            case .importNode(let path, let asName, span: _):
                let modName =
                    if let asName = asName {
                        asName
                    } else {
                        path.lastName()
                    }
                items.append(.importNode(asName: modName))
            case .moduleNode(moduleDeclare: _, span: _):
                break
            case .valNode(let declare):
                switch analyzeVal(
                    name: declare.name, ty: declare.ty, value: declare.value, span: declare.span,
                    modEnv: modEnv)
                {
                case .failure(let error):
                    return .failure(error)
                case .success(let moduleItem):
                    items.append(moduleItem)
                }
            case .funcNode(let funcDef):
                switch analyzeFunc(
                    name: funcDef.name, value: funcDef.value, span: funcDef.span, modEnv: modEnv)
                {
                case .failure(let error):
                    return .failure(error)
                case .success(let moduleItem):
                    items.append(moduleItem)
                }
            case .exprStmtNode(let expr, span: _):
                switch analyzeExpr(letLevel: 0, expr: expr, varEnv: modEnv) {
                case .failure(let error):
                    return .failure(error)
                case let .success(result):
                    items.append(.exprStmtNode(expr: result.expr))
                }
            case .structDefNode(_):
                // TODO
                break
            }
        }

        for def in additionalDefs {
            // modEnv.addNewVarTy(name: def.name, ty: def.ty)
            items.append(.variableDeclare(def))
        }

        return .success(
            AjisaiModule(
                items: items, envId: modEnv.envId, rootTableSize: modEnv.rootTableSize,
                globalRootTableSize: globalRootIdState.value))
    }

    func analyzeVal(
        name: String, ty: AjisaiTypeNode, value: AjisaiExprNode, span: AjisaiSpan?,
        modEnv: AjisaiEnv
    )
        -> SemantResult<AjisaiModuleItem>
    {
        let ty1 = AjisaiType.from(typeNode: ty)

        switch ty1 {
        case .function(kind: _, argTypes: _, bodyType: _):
            inFuncDef = true
        default:
            break
        }
        let result = analyzeTypedDeclare(
            letLevel: 0, name: name, ty: ty1, value: value, span: span, varEnv: modEnv)
        inFuncDef = false

        return result.map {
            declare in .variableDeclare(declare)
        }
    }

    func analyzeTypedDeclare(
        letLevel: UInt, name: String, ty: AjisaiType, value: AjisaiExprNode, span: AjisaiSpan?,
        varEnv: AjisaiEnv
    )
        -> SemantResult<AjisaiVariableDeclare>
    {

        let result = analyzeDeclare(
            letLevel: letLevel, name: name, value: value, span: span, varEnv: varEnv)

        switch result {
        case .failure(let error):
            return .failure(error)
        case .success(let result):
            switch ty.unify(with: result.ty) {
            case let .failure(typeError):
                return .failure(.typeError(content: typeError))
            case .success(_):
                return .success(result)
            }
        }
    }

    func analyzeFunc(
        name: String, value: AjisaiExprNode, span: AjisaiSpan?, modEnv: AjisaiEnv
    )
        -> SemantResult<AjisaiModuleItem>
    {
        inFuncDef = true
        let result = analyzeDeclare(
            letLevel: 0, name: name, value: value, span: span, varEnv: modEnv)
        inFuncDef = false

        switch result {
        case .failure(let error):
            return .failure(error)
        case .success(let result):
            return .success(.variableDeclare(result))
        }
    }

    func analyzeDeclare(
        letLevel: UInt, name: String, value: AjisaiExprNode, span: AjisaiSpan?, varEnv: AjisaiEnv
    )
        -> SemantResult<AjisaiVariableDeclare>
    {
        if varEnv.envKind == .module {
            guard let varTy = modEnv.getVarTy(name: name) else {
                return .failure(.unreachable)
            }
            guard varTy.envId == modEnv.envId else {
                return .failure(.unreachable)
            }
            // 再帰関数の解析のためにここで型情報を登録する
            precedingDefTypeMap[name] = varTy.ty
        } else if varEnv.envKind == .let_ {
            // ローカルの関数定義についても、再帰関数の解析のためにここで型情報を登録する
            addFnVarType: switch value {
            case let .fnExprNode(args: args, body: _, bodyTy: bodyTy, span: _):
                var argTypes: [AjisaiType] = []
                for arg in args {
                    if let argTy = arg.ty {
                        argTypes.append(AjisaiType.from(typeNode: argTy))
                    } else {
                        break addFnVarType
                    }
                }
                let bodyType: AjisaiType =
                    if let bodyTy = bodyTy {
                        AjisaiType.from(typeNode: bodyTy)
                    } else {
                        .unit
                    }
                varEnv.addNewVarTy(
                    name: name,
                    ty: .function(kind: .closure, argTypes: argTypes, bodyType: bodyType))
            default:
                break
            }
        }

        let result = analyzeExpr(letLevel: letLevel, expr: value, varEnv: varEnv)

        switch result {
        case .failure(let error):
            return .failure(error)
        case .success(let result):
            let resultTy: AjisaiType =
                if varEnv.envKind == .module {
                    switch result.ty {
                    case let .function(kind: _, argTypes: argTypes, bodyType: bodyType):
                        switch result.expr {
                        case .funcNode(
                            args: _, body: _, bodyTy: _, ty: _, envId: _, rootTableSize: _,
                            closureId: _, rootIdx: _):
                            .function(kind: .userdef, argTypes: argTypes, bodyType: bodyType)
                        default:
                            .function(kind: .closure, argTypes: argTypes, bodyType: bodyType)
                        }
                    default:
                        result.ty
                    }
                } else {
                    switch result.ty {
                    case let .function(kind: _, argTypes: argTypes, bodyType: bodyType):
                        .function(kind: .closure, argTypes: argTypes, bodyType: bodyType)
                    default:
                        result.ty
                    }
                }

            switch varEnv.envKind {
            case .module:
                // モジュールの環境は式の解析前に全てのモジュールレベル変数の型を登録している
                // ので、ここでは環境に型を記録しない
                // varEnv.addNewVarTy(name: name, ty: resultTy)
                break
            case .fn, .let_:
                varEnv.addNewVarTy(name: name, ty: resultTy)
            case .builtin:
                return .failure(.unreachable)
            }

            let globalRootIdx: UInt? =
                if varEnv.envKind == .module {
                    switch resultTy {
                    case .function(kind: _, argTypes: _, bodyType: _):
                        nil
                    case _ where resultTy.mayBeHeapObject():
                        freshGlobalRootId
                    default:
                        nil
                    }
                } else {
                    nil
                }
            return .success(
                AjisaiVariableDeclare(
                    name: name, ty: resultTy, value: result.expr,
                    modName: importGraph.modName.renamed, globalRootIdx: globalRootIdx))
        }
    }

    func analyzeExpr(letLevel: UInt, expr: AjisaiExprNode, varEnv: AjisaiEnv) -> SemantResult<
        (expr: AjisaiExpr, ty: AjisaiType)
    > {
        switch expr {
        case let .exprSeqNode(exprs: exprs, span: _):
            return analyzeExprSeq(letLevel: letLevel, exprs: exprs, varEnv: varEnv)
        case let .fnExprNode(args: args, body: body, bodyTy: bodyTy, span: span):
            return analyzeFnExpr(
                letLevel: letLevel, args: args, body: body, bodyTy: bodyTy, span: span,
                parentEnv: varEnv)
        case let .callNode(callee: callee, args: args, span: _):
            return analyzeCall(letLevel: letLevel, callee: callee, args: args, varEnv: varEnv)
        case let .letNode(declares: declares, body: body, span: _):
            return analyzeLet(letLevel: letLevel, declares: declares, body: body, parentEnv: varEnv)
        case let .ifNode(cond: cond, then: then, els: els, span: _):
            return analyzeIf(letLevel: letLevel, cond: cond, then: then, else_: els, varEnv: varEnv)
        case let .unaryNode(opKind: opKind, operand: operand, span: _):
            return analyzeUnary(
                letLevel: letLevel, opKind: opKind, operand: operand, varEnv: varEnv)
        case let .binaryNode(opKind: opKind, left: lhs, right: rhs, span: _):
            return analyzeBinary(
                letLevel: letLevel, opKind: opKind, lhs: lhs, rhs: rhs, varEnv: varEnv)
        case let .variableNode(name: name, span: span):
            return analyzeVariable(letLevel: letLevel, varName: name, span: span, varEnv: varEnv)
        case let .pathNode(path):
            return analyzePath(path: path)
        case .integerNode(let value, span: _):
            // TODO: i32 以外の整数型のことを考慮
            return .success((expr: .integerNode(value: value), ty: .i32))
        case .boolNode(let value, span: _):
            return .success((expr: .boolNode(value: value), ty: .bool))
        case .stringNode(let value, span: _):
            return .success((expr: analyzeStringNode(value: value), ty: .str))
        case .unitNode(span: _):
            return .success((expr: .unitNode, ty: .unit))
        }
    }

    func analyzeExprSeq(letLevel: UInt, exprs: [AjisaiExprNode], varEnv: AjisaiEnv) -> SemantResult<
        (expr: AjisaiExpr, ty: AjisaiType)
    > {
        var analyzedExprs: [AjisaiExpr] = []
        var ty: AjisaiType = .unit

        for expr in exprs {
            switch analyzeExpr(letLevel: letLevel, expr: expr, varEnv: varEnv) {
            case .failure(let error):
                return .failure(error)
            case let .success((expr: analyzedExpr, ty: exprTy)):
                analyzedExprs.append(analyzedExpr)
                ty = exprTy
            }
        }

        return .success((expr: .exprSeqNode(exprs: analyzedExprs, ty: ty), ty: ty))
    }

    func analyzeFnExpr(
        letLevel: UInt, args: [(name: String, ty: AjisaiTypeNode?, span: AjisaiSpan?)],
        body: AjisaiExprNode,
        bodyTy: AjisaiTypeNode?, span: AjisaiSpan?, parentEnv: AjisaiEnv
    ) -> SemantResult<(expr: AjisaiExpr, ty: AjisaiType)> {
        let varEnv = AjisaiEnv(envId: freshEnvId, envKind: .fn, parent: parentEnv)

        for case let (name, ty, _) in args {
            let varTy = varEnv.getVarTy(name: name)
            if let varTy = varTy {
                guard varTy.envId != varEnv.envId else {
                    return .failure(.duplicatedVarInFuncParams(name: name, span: span))
                }
            }
            if let ty = ty {
                switch AjisaiType.from(typeNode: ty) {
                case let .function(kind: _, argTypes: argTypes, bodyType: bodyType):
                    varEnv.addNewVarTy(
                        name: name,
                        ty: .function(kind: .closure, argTypes: argTypes, bodyType: bodyType))
                case let other:
                    varEnv.addNewVarTy(name: name, ty: other)
                }
            } else {
                varEnv.addNewVarTy(name: name, ty: newTVar(letLevel: letLevel))
            }
        }

        switch analyzeExpr(letLevel: letLevel, expr: body, varEnv: varEnv) {
        case .failure(let error):
            return .failure(error)
        case let .success((expr: bodyExpr, ty: bodyType)):
            if let bodyTy = bodyTy {
                let expected = AjisaiType.from(typeNode: bodyTy)
                switch bodyType.unify(with: expected) {
                case let .failure(typeError):
                    return .failure(.typeError(content: typeError))
                case .success(_):
                    break
                }
            }

            var argTypes: [AjisaiType] = []
            var funcArgs: [AjisaiFuncArg] = []
            for case let (name, _, _) in args {
                guard let varTy = varEnv.getVarTy(name: name) else {
                    return .failure(.unreachable)
                }
                guard varTy.envId == varEnv.envId else {
                    return .failure(.unreachable)
                }
                guard varTy.envKind == .fn else {
                    return .failure(.unreachable)
                }
                argTypes.append(varTy.ty)
                funcArgs.append(AjisaiFuncArg(name: name, ty: varTy.ty))
            }

            let funcKind: AjisaiFuncKind =
                if parentEnv.envKind == .module && inFuncDef {
                    .userdef
                } else {
                    .closure
                }

            let funcTy: AjisaiType = .function(
                kind: funcKind, argTypes: argTypes, bodyType: bodyType)

            let closureId: UInt? =
                if parentEnv.envKind == .module && inFuncDef {
                    nil
                } else {
                    freshClosureId
                }

            let rootIdx: UInt? =
                if parentEnv.envKind == .module && inFuncDef {
                    nil
                } else {
                    parentEnv.freshRootId()
                }

            let fnExpr: AjisaiExpr = .funcNode(
                args: funcArgs, body: bodyExpr, bodyTy: bodyType, ty: funcTy, envId: varEnv.envId,
                rootTableSize: varEnv.rootTableSize, closureId: closureId, rootIdx: rootIdx)

            if funcKind == .closure {
                additionalDefs.append(
                    AjisaiVariableDeclare(
                        name: String(closureId!), ty: funcTy, value: fnExpr,
                        modName: importGraph.modName.renamed, globalRootIdx: nil))
            }

            return .success((expr: fnExpr, ty: funcTy))
        }
    }

    func analyzeCall(
        letLevel: UInt, callee: AjisaiExprNode, args: [AjisaiExprNode], varEnv: AjisaiEnv
    )
        -> SemantResult<(expr: AjisaiExpr, ty: AjisaiType)>
    {
        switch analyzeExpr(letLevel: letLevel, expr: callee, varEnv: varEnv) {
        case .failure(let error):
            return .failure(error)
        case let .success((expr: calleeExpr, ty: calleeTy)):
            var argTypes: [AjisaiType] = []
            var analyzedArgs: [AjisaiExpr] = []

            for arg in args {
                switch analyzeExpr(letLevel: letLevel, expr: arg, varEnv: varEnv) {
                case .failure(let error):
                    return .failure(error)
                case let .success((expr: argExpr, ty: argTy)):
                    argTypes.append(argTy)
                    analyzedArgs.append(argExpr)
                }
            }

            switch matchFnTy(calleeType: calleeTy, argTypes: argTypes) {
            case .failure(let error):
                return .failure(error)
            case .success(let returnType):
                // NOTE: returnType がまだ単一化され切っていない時、rootIdx が必要かどうかを
                // まだ判断できない
                return .success(
                    (
                        expr: .callNode(
                            callee: calleeExpr, args: analyzedArgs, ty: returnType,
                            calleeTy: calleeTy,
                            rootIdx: returnType.mayBeHeapObject() ? varEnv.freshRootId() : nil),
                        ty: returnType
                    ))
            }
        }
    }

    func matchFnTy(calleeType: AjisaiType, argTypes: [AjisaiType]) -> SemantResult<AjisaiType> {
        switch calleeType {
        case let .function(kind: _, argTypes: paramTypes, bodyType: bodyType):
            for (paramType, argType) in zip(paramTypes, argTypes) {
                switch paramType.unify(with: argType) {
                case let .failure(error):
                    return .failure(.typeError(content: error))
                default:
                    break
                }
            }
            return .success(bodyType)
        case let .tvar(tvar):
            switch tvar.value {
            case let .link(ty: ty):
                return matchFnTy(calleeType: ty, argTypes: argTypes)
            case .unbound(id: _, letLevel: let level):
                let paramTypes = (0..<argTypes.count).map { _ in newTVar(letLevel: level) }
                let bodyType = newTVar(letLevel: level)
                tvar.value = .link(
                    ty: .function(kind: .closure, argTypes: paramTypes, bodyType: bodyType))

                for (paramType, argType) in zip(paramTypes, argTypes) {
                    switch paramType.unify(with: argType) {
                    case let .failure(error):
                        return .failure(.typeError(content: error))
                    default:
                        break
                    }
                }

                return .success(bodyType)
            case .generic(id: _):
                return .failure(.invalidCalleeType(got: "\(calleeType)"))
            }
        default:
            return .failure(.invalidCalleeType(got: "\(calleeType)"))
        }
    }

    func generalize(letLevel: UInt, ty: AjisaiType) -> AjisaiType {
        switch ty {
        case .tvar(let tvar):
            switch tvar.value {
            case .unbound(id: let id1, letLevel: let level1) where letLevel < level1:
                return .tvar(AjisaiRef(.generic(id: id1)))
            case .unbound(id: _, letLevel: _):
                return ty
            case .link(ty: let ty1):
                return generalize(letLevel: letLevel, ty: ty1)
            case .generic(id: _):
                return ty
            }
        case let .function(kind: kind, argTypes: argTypes, bodyType: bodyType):
            return .function(
                kind: kind,
                argTypes: argTypes.map { argType in generalize(letLevel: letLevel, ty: argType) },
                bodyType: generalize(letLevel: letLevel, ty: bodyType))
        default:
            return ty
        }
    }

    func instantiate(letLevel: UInt, ty: AjisaiType) -> AjisaiType {
        var idVarDict: [UInt: AjisaiType] = [:]

        func f(ty: AjisaiType) -> AjisaiType {
            switch ty {
            case .tvar(let tvar):
                switch tvar.value {
                case .generic(let id):
                    if let var_ = idVarDict[id] {
                        return var_
                    } else {
                        let var_ = newTVar(letLevel: letLevel)
                        idVarDict[id] = var_
                        return var_
                    }
                case .unbound(id: _, letLevel: _):
                    return ty
                case .link(let ty):
                    return f(ty: ty)
                }
            case let .function(kind: kind, argTypes: argTypes, bodyType: bodyType):
                return .function(
                    kind: kind, argTypes: argTypes.map { argType in f(ty: argType) },
                    bodyType: f(ty: bodyType))
            default:
                return ty
            }
        }

        return f(ty: ty)
    }

    func analyzeVariable(letLevel: UInt, varName: String, span: AjisaiSpan?, varEnv: AjisaiEnv)
        -> SemantResult<
            (expr: AjisaiExpr, ty: AjisaiType)
        >
    {
        let varTy = varEnv.getVarTy(name: varName)
        guard let varTy = varTy else {
            return .failure(.variableNotFound(name: varName, span: span))
        }

        switch varTy.envKind {
        case .builtin, .module:
            // NOTE: 相互再帰を可能にするために、ある関数定義内で後ろに定義されている関数を呼び出すことを可能にしている。
            //       一方、その他の型のモジュールレベル変数の初期化式内では、後方で定義されている変数へのアクセスや関数の呼び出しを
            //       禁止する。これは特に変数どうしの初期化の順序関係に基づく制限である（変数の初期化式内で後ろにある関数を呼び出す
            //       ことに関しては技術的な制限はないが、変数どうしの関係に一貫性を持たせるために同様に禁止している）。
            //       この際、 関数 A とその後方で定義されている非関数型の変数 x があって、関数 A がその定義内で変数 x より後ろで
            //       定義されている変数 y を参照しているとき、変数 x の初期化時に A の呼び出しが行われるとしたら、y を x より先に
            //       初期化する必要が生じてしまい、x と y の初期化順序が原則に反してしまう。これを避けるために、ある関数内からその
            //       後方で定義されている変数へのアクセスを禁止する。まとめると、次の２つの条件のみ許可する：
            //
            //       - 非関数の変数の初期化式で、前方で定義されている変数を参照する
            //       - 関数定義内で、関数（後方で定義されているものも可）あるいは前方で定義されている変数を参照する
            guard
                (!inFuncDef && (precedingDefTypeMap[varName] != nil || varTy.envKind == .builtin))
                    || (inFuncDef && (varTy.ty.isFunc || precedingDefTypeMap[varName] != nil))
            else {
                return .failure(.variableNotInPrecedingDefinitions(name: varName, span: span))
            }
            return .success(
                (
                    expr: .globalVarNode(
                        name: varName, modName: importGraph.modName.renamed, ty: varTy.ty),
                    ty: varTy.ty
                ))
        case .fn, .let_:
            let ty = instantiate(letLevel: letLevel, ty: varTy.ty)
            return .success(
                (expr: .localVarNode(name: varName, envId: varTy.envId, ty: ty), ty: ty))
        }
    }

    func analyzePath(path: AjisaiPathNode) -> SemantResult<(expr: AjisaiExpr, ty: AjisaiType)> {
        switch path {
        case .pathEnd(name: _, span: _):
            return .failure(.unreachable)
        case let .path(sup: supName, sub: subPath, supSpan: supSpan):
            let supMod = analyzedImportMods.first { mod in
                mod.name == supName
            }
            guard let supMod = supMod else {
                return .failure(.moduleNotFound(name: supName, span: supSpan))
            }
            switch subPath {
            case let .path(sup: supName1, sub: _, supSpan: supSpan1):
                return .failure(.nestedModuleAccess(name: supName1, span: supSpan1))
            case let .pathEnd(name: varName, span: endSpan):
                for item in supMod.node.mod.items {
                    switch item {
                    case let .variableDeclare(declare):
                        if declare.name == varName {
                            return .success(
                                (
                                    expr: .globalVarNode(
                                        name: declare.name, modName: supMod.node.modName.renamed,
                                        ty: declare.ty),
                                    ty: declare.ty
                                ))
                        }
                    default:
                        break
                    }
                }
                return .failure(
                    .modLevelVariableNotFound(
                        name: varName, modName: supMod.node.modName.orig, span: endSpan))
            }
        }
    }

    func analyzeLet(
        letLevel: UInt, declares: [AjisaiLetDeclareNode], body: AjisaiExprNode, parentEnv: AjisaiEnv
    )
        -> SemantResult<(expr: AjisaiExpr, ty: AjisaiType)>
    {
        let varEnv = AjisaiEnv(envId: freshEnvId, envKind: .let_, parent: parentEnv)

        var analyzedDeclares: [AjisaiVariableDeclare] = []
        for declare in declares {
            switch analyzeLetDeclare(letLevel: letLevel, declare: declare, varEnv: varEnv) {
            case let .failure(error):
                return .failure(error)
            case let .success(declare):
                analyzedDeclares.append(declare)
            }
        }

        let bodyResult = analyzeExpr(letLevel: letLevel, expr: body, varEnv: varEnv)

        return bodyResult.map { bodyAndTy in
            (
                expr: .letNode(
                    declares: analyzedDeclares, body: bodyAndTy.expr, bodyTy: bodyAndTy.ty,
                    envId: varEnv.envId,
                    rootIdx: bodyAndTy.ty.mayBeHeapObject() ? parentEnv.freshRootId() : nil,
                    rootIndices: varEnv.rootIndices), ty: bodyAndTy.ty
            )
        }
    }

    func analyzeLetDeclare(letLevel: UInt, declare: AjisaiLetDeclareNode, varEnv: AjisaiEnv)
        -> SemantResult<
            AjisaiVariableDeclare
        >
    {
        switch declare {
        case let .funcDeclare(funcDef: funcDef):
            let result = varEnv.getVarTy(name: funcDef.name)
            if let result = result {
                guard result.envId != varEnv.envId else {
                    return .failure(.duplicatedVarInLet(name: funcDef.name, span: funcDef.span))
                }
            }
            return analyzeDeclare(
                letLevel: letLevel + 1, name: funcDef.name, value: funcDef.value,
                span: funcDef.span,
                varEnv: varEnv)
        case let .variableDeclare(declare: declare):
            let result = varEnv.getVarTy(name: declare.name)
            if let result = result {
                guard result.envId != varEnv.envId else {
                    return .failure(.duplicatedVarInLet(name: declare.name, span: declare.span))
                }
            }
            if let ty = declare.ty {
                return analyzeTypedDeclare(
                    letLevel: letLevel + 1, name: declare.name, ty: AjisaiType.from(typeNode: ty),
                    value: declare.value, span: declare.span, varEnv: varEnv)
            } else {
                switch analyzeDeclare(
                    letLevel: letLevel + 1, name: declare.name, value: declare.value,
                    span: declare.span, varEnv: varEnv)
                {
                case .failure(let error):
                    return .failure(error)
                case .success(let analyzedDeclare):
                    let tgen = generalize(letLevel: letLevel, ty: analyzedDeclare.ty)
                    varEnv.setVarTy(name: analyzedDeclare.name, ty: tgen)
                    return .success(
                        AjisaiVariableDeclare(
                            name: analyzedDeclare.name, ty: tgen, value: analyzedDeclare.value,
                            modName: analyzedDeclare.modName,
                            globalRootIdx: analyzedDeclare.globalRootIdx))
                }
            }
        }
    }

    func analyzeIf(
        letLevel: UInt, cond: AjisaiExprNode, then: AjisaiExprNode, else_: AjisaiExprNode,
        varEnv: AjisaiEnv
    ) -> SemantResult<(expr: AjisaiExpr, ty: AjisaiType)> {
        analyzeExpr(letLevel: letLevel, expr: cond, varEnv: varEnv).flatMap { condResult in
            condResult.ty.unify(with: .bool).mapError {
                typeError in AjisaiSemantError.typeError(content: typeError)
            }.flatMap { _ in
                analyzeExpr(letLevel: letLevel, expr: then, varEnv: varEnv).flatMap { thenResult in
                    analyzeExpr(letLevel: letLevel, expr: else_, varEnv: varEnv).flatMap {
                        elseResult in
                        thenResult.ty.unify(with: elseResult.ty).mapError { typeError in
                            AjisaiSemantError.typeError(content: typeError)
                        }.map { _ in
                            (
                                expr: AjisaiExpr.ifNode(
                                    cond: condResult.expr, then: thenResult.expr,
                                    els: elseResult.expr, ty: thenResult.ty),
                                ty: thenResult.ty
                            )
                        }
                    }
                }
            }
        }
    }

    func analyzeUnary(
        letLevel: UInt, opKind: AjisaiUnOpKind, operand: AjisaiExprNode, varEnv: AjisaiEnv
    ) -> SemantResult<(expr: AjisaiExpr, ty: AjisaiType)> {
        switch opKind {
        case .minus:
            switch analyzeExpr(letLevel: letLevel, expr: operand, varEnv: varEnv) {
            case let .failure(error):
                return .failure(error)
            case let .success((expr: operandExpr, ty: operandTy)):
                switch operandTy.unify(with: .i32) {
                case let .failure(error):
                    return .failure(.typeError(content: error))
                case .success(_):
                    return .success(
                        (expr: .unaryNode(opKind: .neg, operand: operandExpr, ty: .i32), ty: .i32))
                }
            }
        case .neg:
            switch analyzeExpr(letLevel: letLevel, expr: operand, varEnv: varEnv) {
            case let .failure(error):
                return .failure(error)
            case let .success((expr: operandExpr, ty: operandTy)):
                switch operandTy.unify(with: .bool) {
                case let .failure(error):
                    return .failure(.typeError(content: error))
                case .success(_):
                    return .success(
                        (expr: .unaryNode(opKind: .neg, operand: operandExpr, ty: .bool), ty: .bool)
                    )
                }
            }
        }
    }

    func analyzeBinary(
        letLevel: UInt, opKind: AjisaiBinOpKind, lhs: AjisaiExprNode, rhs: AjisaiExprNode,
        varEnv: AjisaiEnv
    ) -> SemantResult<(expr: AjisaiExpr, ty: AjisaiType)> {
        // TODO: 最終的には各演算子に対応した trait が実装されているかどうか調べる検査に置き換える
        // かもしれない
        let opKind1: AjisaiBinOp =
            switch opKind {
            case .add: .add
            case .sub: .sub
            case .mul: .mul
            case .div: .div
            case .mod: .mod
            case .eq: .eq
            case .neq: .neq
            case .lt: .lt
            case .le: .le
            case .gt: .gt
            case .ge: .ge
            case .logand: .logand
            case .logor: .logor
            }

        switch opKind {
        case .add:
            switch analyzeExpr(letLevel: letLevel, expr: lhs, varEnv: varEnv) {
            case let .failure(error):
                return .failure(error)
            case let .success((expr: leftExpr, ty: leftTy)):
                let addstate: AddState = AjisaiRef(nil)
                switch leftTy.unify(with: .add(addstate)) {
                case let .failure(error):
                    return .failure(.typeError(content: error))
                case .success(_):
                    switch analyzeExpr(letLevel: letLevel, expr: rhs, varEnv: varEnv) {
                    case let .failure(error):
                        return .failure(error)
                    case let .success((expr: rightExpr, ty: rightTy)):
                        switch rightTy.unify(with: leftTy) {
                        case let .failure(error):
                            return .failure(.typeError(content: error))
                        case .success(_):
                            return .success(
                                (
                                    expr: .binaryNode(
                                        opKind: opKind1, left: leftExpr, right: rightExpr,
                                        ty: leftTy,
                                        rootIdx: leftTy.mayBeHeapObject()
                                            ? varEnv.freshRootId() : nil),
                                    ty: leftTy
                                ))
                        }
                    }
                }
            }
        case .sub, .mul, .div, .mod:
            switch analyzeExpr(letLevel: letLevel, expr: lhs, varEnv: varEnv) {
            case let .failure(error):
                return .failure(error)
            case let .success((expr: leftExpr, ty: leftTy)):
                switch leftTy.unify(with: .i32) {
                case let .failure(error):
                    return .failure(.typeError(content: error))
                case .success(_):
                    switch analyzeExpr(letLevel: letLevel, expr: rhs, varEnv: varEnv) {
                    case let .failure(error):
                        return .failure(error)
                    case let .success((expr: rightExpr, ty: rightTy)):
                        switch rightTy.unify(with: .i32) {
                        case let .failure(error):
                            return .failure(.typeError(content: error))
                        case .success(_):
                            return .success(
                                (
                                    expr: .binaryNode(
                                        opKind: opKind1, left: leftExpr, right: rightExpr, ty: .i32,
                                        rootIdx: nil),
                                    ty: .i32
                                ))
                        }
                    }
                }
            }
        case .eq, .neq:
            switch analyzeExpr(letLevel: letLevel, expr: lhs, varEnv: varEnv) {
            case let .failure(error):
                return .failure(error)
            case let .success((expr: leftExpr, ty: leftTy)):
                let eqstate: EqState = AjisaiRef(nil)
                switch leftTy.unify(with: .eq(eqstate)) {
                case let .failure(error):
                    return .failure(.typeError(content: error))
                case .success(_):
                    switch analyzeExpr(letLevel: letLevel, expr: rhs, varEnv: varEnv) {
                    case let .failure(error):
                        return .failure(error)
                    case let .success((expr: rightExpr, ty: rightTy)):
                        switch rightTy.unify(with: leftTy) {
                        case let .failure(error):
                            return .failure(.typeError(content: error))
                        case .success(_):
                            return .success(
                                (
                                    expr: .binaryNode(
                                        opKind: opKind1, left: leftExpr, right: rightExpr,
                                        ty: .bool,
                                        rootIdx: nil),
                                    ty: .bool
                                ))
                        }
                    }
                }
            }
        case .lt, .le, .gt, .ge:
            switch analyzeExpr(letLevel: letLevel, expr: lhs, varEnv: varEnv) {
            case let .failure(error):
                return .failure(error)
            case let .success((expr: leftExpr, ty: leftTy)):
                switch leftTy.unify(with: .i32) {
                case let .failure(error):
                    return .failure(.typeError(content: error))
                case .success(_):
                    switch analyzeExpr(letLevel: letLevel, expr: rhs, varEnv: varEnv) {
                    case let .failure(error):
                        return .failure(error)
                    case let .success((expr: rightExpr, ty: rightTy)):
                        switch rightTy.unify(with: .i32) {
                        case let .failure(error):
                            return .failure(.typeError(content: error))
                        case .success(_):
                            return .success(
                                (
                                    expr: .binaryNode(
                                        opKind: opKind1, left: leftExpr, right: rightExpr,
                                        ty: .bool,
                                        rootIdx: nil),
                                    ty: .bool
                                ))
                        }
                    }
                }
            }
        case .logand, .logor:
            switch analyzeExpr(letLevel: letLevel, expr: lhs, varEnv: varEnv) {
            case let .failure(error):
                return .failure(error)
            case let .success((expr: leftExpr, ty: leftTy)):
                switch leftTy.unify(with: .bool) {
                case let .failure(error):
                    return .failure(.typeError(content: error))
                case .success(_):
                    switch analyzeExpr(letLevel: letLevel, expr: rhs, varEnv: varEnv) {
                    case let .failure(error):
                        return .failure(error)
                    case let .success((expr: rightExpr, ty: rightTy)):
                        switch rightTy.unify(with: .bool) {
                        case let .failure(error):
                            return .failure(.typeError(content: error))
                        case .success(_):
                            return .success(
                                (
                                    expr: .binaryNode(
                                        opKind: opKind1, left: leftExpr, right: rightExpr,
                                        ty: .bool,
                                        rootIdx: nil),
                                    ty: .bool
                                ))
                        }
                    }
                }
            }
        }
    }

    func analyzeStringNode(value: String) -> AjisaiExpr {
        var len: UInt = 0
        for ch in value {
            // TODO: エスケープシーケンスについて考慮すべきことを洗い出す
            if ch == "\\" {
                continue
            }
            len += 1
        }
        return .stringNode(value: value, len: len)
    }
}

func makeBuiltinEnv() -> AjisaiEnv {
    // TODO: 組み込み関数呼び出し構文を新たに作りたいので、AjisaiEnv ではなく
    // defTypeMap での管理に戻すと思う
    let builtinEnv = AjisaiEnv(envId: 0, envKind: .builtin)
    builtinEnv.addNewVarTy(
        name: "print_i32",
        ty: .function(kind: .builtin, argTypes: [.i32], bodyType: .unit))
    builtinEnv.addNewVarTy(
        name: "println_i32",
        ty: .function(kind: .builtin, argTypes: [.i32], bodyType: .unit))
    builtinEnv.addNewVarTy(
        name: "print_bool",
        ty: .function(kind: .builtin, argTypes: [.bool], bodyType: .unit))
    builtinEnv.addNewVarTy(
        name: "println_bool",
        ty: .function(kind: .builtin, argTypes: [.bool], bodyType: .unit))
    builtinEnv.addNewVarTy(
        name: "print",
        ty: .function(kind: .builtin, argTypes: [.str], bodyType: .unit))
    builtinEnv.addNewVarTy(
        name: "println",
        ty: .function(kind: .builtin, argTypes: [.str], bodyType: .unit))
    builtinEnv.addNewVarTy(
        name: "flush",
        ty: .function(kind: .builtin, argTypes: [], bodyType: .unit))
    builtinEnv.addNewVarTy(
        name: "str_concat",
        ty: .function(kind: .builtin, argTypes: [.str, .str], bodyType: .str))
    builtinEnv.addNewVarTy(
        name: "str_slice",
        ty: .function(kind: .builtin, argTypes: [.str, .i32, .i32], bodyType: .str))
    builtinEnv.addNewVarTy(
        name: "str_equal",
        ty: .function(kind: .builtin, argTypes: [.str, .str], bodyType: .bool))
    builtinEnv.addNewVarTy(
        name: "str_repeat",
        ty: .function(kind: .builtin, argTypes: [.str, .i32], bodyType: .str))
    builtinEnv.addNewVarTy(
        name: "str_len",
        ty: .function(kind: .builtin, argTypes: [.str], bodyType: .i32))
    builtinEnv.addNewVarTy(
        name: "gc_start",
        ty: .function(kind: .builtin, argTypes: [], bodyType: .unit))

    return builtinEnv
}

public func semanticAnalyze(modDeclare: AjisaiModuleDeclareNode) -> SemantResult<
    AjisaiImportGraphNode<AjisaiModule>
> {
    switch makeImportGraph(modDeclare: modDeclare) {
    case .failure(let error):
        return .failure(.importGraphError(content: error))
    case .success(let importGraph):
        let builtinEnv = makeBuiltinEnv()
        let semAnalyzer = AjisaiSemanticAnalyzer(importGraph: importGraph, builtins: builtinEnv)

        return semAnalyzer.analyze()
    }
}
