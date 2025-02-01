import AjisaiSemanticAnalyzer
import Foundation

enum ModuleInitItem {
    case exprStmt(expr: AjisaiExpr)
    case importMod(modName: String)
    case valDef(declare: AjisaiVariableDeclare)
}

public final class AjisaiCodeGenerator {
    let importGraph: AjisaiImportGraphNode<AjisaiModule>

    public init(importGraph: AjisaiImportGraphNode<AjisaiModule>) {
        self.importGraph = importGraph
    }

    public func codegen() -> ACProgram {
        let subModCode = codegenModule()

        return ACProgram(
            decls: subModCode.decls,
            funcDefs: subModCode.funcDefs,
            modInitDefs: subModCode.modInitDefs,
            entryModName: importGraph.modName.renamed,
            globalRootTableSize: importGraph.mod.globalRootTableSize)
    }

    struct SubmoduleCode {
        let decls: [ACDeclInst]
        let funcDefs: [ACDefInst]
        let modInitDefs: [ACModInitDefInst]
    }

    func codegenModule() -> SubmoduleCode {
        var decls: [ACDeclInst] = []
        var funcDefs: [ACDefInst] = []
        var modInitDefs: [ACModInitDefInst] = []

        var modInitsNumMap: [String: (renamed: String, initsNum: Int)] = [:]

        for (importModName, importNode) in importGraph.importMods {
            let subCodeGen = AjisaiCodeGenerator(importGraph: importNode)
            let subModCode = subCodeGen.codegenModule()

            modInitsNumMap[importModName] = (
                renamed: importNode.modName.renamed, initsNum: subModCode.modInitDefs.count
            )

            decls.append(contentsOf: subModCode.decls)
            funcDefs.append(contentsOf: subModCode.funcDefs)
            modInitDefs.append(contentsOf: subModCode.modInitDefs)
        }

        var modInitItems: [ModuleInitItem] = []

        for item in importGraph.mod.items {
            switch item {
            case let .importNode(asName: asName):
                let (renamed, initsNum) = modInitsNumMap[asName]!
                if initsNum > 0 {
                    modInitItems.append(.importMod(modName: renamed))
                }
            case let .exprStmtNode(expr: expr):
                modInitItems.append(.exprStmt(expr: expr))
            case let .variableDeclare(declare):
                switch declare.value {
                case let .funcNode(
                    args: args, body: body, bodyTy: bodyTy, ty: _, envId: envId,
                    rootTableSize: rootTableSize, closureId: closureId, rootIdx: _):

                    let funcCodeGen = FuncCodeGenerator(
                        funcName: declare.name,
                        modName: declare.modName,
                        bodyType: bodyTy,
                        args: args,
                        body: body,
                        envId: envId,
                        rootTableSize: rootTableSize,
                        closureId: closureId)

                    let (funcDecl, funcDef) = funcCodeGen.codegen()
                    decls.append(funcDecl)
                    funcDefs.append(funcDef)
                default:
                    if declare.ty != .unit {
                        decls.append(
                            .val_decl(
                                varName: declare.name, ty: declare.ty, modName: declare.modName))
                    }
                    modInitItems.append(.valDef(declare: declare))
                }
            }
        }

        if modInitItems.count > 0 {
            let modInitCodegen = ModInitCodeGenerator(
                modName: importGraph.modName.renamed, envId: importGraph.mod.envId,
                rootTableSize: importGraph.mod.rootTableSize, items: modInitItems)
            modInitDefs.append(modInitCodegen.codegen())
        }

        return SubmoduleCode(decls: decls, funcDefs: funcDefs, modInitDefs: modInitDefs)
    }
}

final class FuncContext {
    let funcName: String
    var funcEnvId: UInt
    var tmpId: UInt = 0

    var freshFuncTmpId: UInt {
        let id = tmpId
        tmpId += 1
        return id
    }

    init(funcName: String, envId: UInt) {
        self.funcName = funcName
        self.funcEnvId = envId
    }
}

final class FuncCodeGenerator {
    let funcCtx: FuncContext
    let modName: String

    let bodyType: AjisaiType

    let args: [AjisaiFuncArg]
    let body: AjisaiExpr
    let envId: UInt
    let rootTableSize: UInt
    let closureId: UInt?

    init(
        funcName: String,
        modName: String,

        bodyType: AjisaiType,

        args: [AjisaiFuncArg],
        body: AjisaiExpr,
        envId: UInt,
        rootTableSize: UInt,
        closureId: UInt?
    ) {
        self.funcCtx = FuncContext(funcName: funcName, envId: envId)
        self.modName = modName

        self.bodyType = bodyType

        self.args = args
        self.body = body
        self.envId = envId
        self.rootTableSize = rootTableSize
        self.closureId = closureId
    }

    func codegen() -> (ACDeclInst, ACDefInst) {
        let funcName = funcCtx.funcName
        let params = args.map { arg in (name: arg.name, ty: arg.ty) }
        let envId = funcCtx.funcEnvId

        let funcDeclInst: ACDeclInst =
            if closureId == nil {
                .func_decl(funcName: funcName, params: params, returnTy: bodyType, modName: modName)
            } else {
                .closure_decl(funcName: funcName, params: params, returnTy: bodyType)
            }

        let bodyInsts = codegenFuncBody()

        let funcDefInst: ACDefInst =
            if closureId == nil {
                .func_def(
                    funcName: funcName, params: params, returnTy: bodyType, modName: modName,
                    envId: envId, body: bodyInsts)
            } else {
                .closure_def(
                    funcName: funcName, params: params, returnTy: bodyType, envId: envId,
                    body: bodyInsts)
            }

        return (funcDeclInst, funcDefInst)
    }

    func codegenFuncBody() -> [ACFuncBodyInst] {
        var bodyInsts: [ACFuncBodyInst] = []

        if rootTableSize > 0 {
            bodyInsts.append(.roottable_init(size: rootTableSize))
        }
        bodyInsts.append(.funcframe_init(rootTableSize: rootTableSize))

        let exprCodegen = ExprCodeGenerator(funcCtx: funcCtx, modName: modName)
        let (prelude, valInst) = exprCodegen.codegen(expr: body)

        if let prelude = prelude {
            bodyInsts.append(contentsOf: prelude)
        }

        if let valInst = valInst {
            if bodyType.tyEqual(to: .unit) {
                bodyInsts.append(.discard_value(valInst))
            } else {
                bodyInsts.append(.func_return(value: valInst))
            }
        }

        return bodyInsts
    }
}

final class ModInitCodeGenerator {
    let modName: String
    let rootTableSize: UInt
    let items: [ModuleInitItem]

    let funcCtx: FuncContext

    init(modName: String, envId: UInt, rootTableSize: UInt, items: [ModuleInitItem]) {
        self.modName = modName
        self.rootTableSize = rootTableSize
        self.items = items

        self.funcCtx = FuncContext(funcName: "", envId: envId)
    }

    func codegen() -> ACModInitDefInst {
        ACModInitDefInst(body: codegenModInitBody(), modName: modName)
    }

    func codegenModInitBody() -> [ACModInitBodyInst] {
        var bodyInsts: [ACModInitBodyInst] = []

        if rootTableSize > 0 {
            bodyInsts.append(.func_body_inst(.roottable_init(size: rootTableSize)))
        }
        bodyInsts.append(.func_body_inst(.funcframe_init(rootTableSize: rootTableSize)))

        for item in items {
            switch item {
            case let .importMod(modName: modName1):
                bodyInsts.append(.mod_init(modName: modName1))
            case let .valDef(declare: declare):
                let exprCodegen = ExprCodeGenerator(funcCtx: funcCtx, modName: modName)
                let (prelude, valInst) = exprCodegen.codegen(expr: declare.value)
                if let prelude = prelude {
                    bodyInsts.append(contentsOf: prelude.map { inst in .func_body_inst(inst) })
                }
                if let valInst = valInst {
                    bodyInsts.append(
                        .modval_init(
                            varName: declare.name, modName: declare.modName, value: valInst))
                    if let globalRootIdx = declare.globalRootIdx {
                        bodyInsts.append(
                            .global_roottable_reg(
                                idx: globalRootIdx, varName: declare.name, modName: declare.modName)
                        )
                    }
                }
            case let .exprStmt(expr: expr):
                let exprCodegen = ExprCodeGenerator(funcCtx: funcCtx, modName: modName)
                let (prelude, valInst) = exprCodegen.codegen(expr: expr)
                if let prelude = prelude {
                    bodyInsts.append(contentsOf: prelude.map { inst in .func_body_inst(inst) })
                }
                if let valInst = valInst {
                    bodyInsts.append(.func_body_inst(.discard_value(valInst)))
                }
            }
        }

        return bodyInsts
    }
}

final class ExprCodeGenerator {
    let funcCtx: FuncContext
    let modName: String

    init(funcCtx: FuncContext, modName: String) {
        self.funcCtx = funcCtx
        self.modName = modName
    }

    func codegen(expr: AjisaiExpr) -> (prelude: [ACFuncBodyInst]?, valInst: ACValueInst?) {
        switch expr {
        case let .exprSeqNode(exprs: exprs, ty: ty):
            return codegenExprSeq(exprs: exprs, ty: ty)
        case let .funcNode(
            args: _, body: _, bodyTy: _, ty: ty, envId: _, rootTableSize: _, closureId: closureId,
            rootIdx: rootIdx):
            return codegenClosure(closureId: closureId!, ty: ty, rootIdx: rootIdx!)
        case let .unaryNode(opKind: opKind, operand: operand, ty: _):
            return codegenUnary(op: opKind, operand: operand)
        case let .binaryNode(opKind: opKind, left: left, right: right, ty: _, rootIdx: rootIdx):
            return codegenBinary(op: opKind, left: left, right: right, rootIdx: rootIdx)
        case let .callNode(callee: callee, args: args, ty: _, calleeTy: calleeTy, rootIdx: rootIdx):
            return codegenCall(callee: callee, calleeTy: calleeTy, args: args, rootIdx: rootIdx)
        case let .letNode(
            declares: declares, body: body, bodyTy: bodyTy, envId: envId, rootIdx: rootIdx,
            rootIndices: rootIndices):
            return codegenLet(
                declares: declares, body: body, bodyTy: bodyTy, envId: envId, rootIdx: rootIdx,
                rootIndices: rootIndices)
        case let .ifNode(cond: cond, then: then, els: els, ty: ty):
            return codegenIf(cond: cond, then: then, els: els, ty: ty)
        case let .integerNode(value: value):
            return (prelude: nil, valInst: .i32_const(value: Int(value)))
        case let .boolNode(value: value):
            return (prelude: nil, valInst: .bool_const(value: value))
        case let .stringNode(value: value, len: len):
            let strId = funcCtx.freshFuncTmpId
            return (
                prelude: [.str_make_static(id: strId, value: value, len: len)],
                valInst: .str_const(id: strId)
            )
        case .unitNode:
            return (prelude: nil, valInst: nil)
        case let .localVarNode(name: varName, envId: envId, ty: _):
            return codegenLocalVar(varName: varName, envId: envId)
        case let .globalVarNode(name: varName, modName: modName, ty: ty):
            return codegenGlobalVar(varName: varName, modName: modName, ty: ty)
        }
    }

    func codegenUnary(op: AjisaiUnOp, operand: AjisaiExpr) -> (
        prelude: [ACFuncBodyInst]?, valInst: ACValueInst?
    ) {
        let (opePrelude, opeValInst) = codegen(expr: operand)
        switch op {
        case .minus:
            return (prelude: opePrelude, valInst: .i32_neg(operand: opeValInst!))
        case .neg:
            return (prelude: opePrelude, valInst: .bool_not(operand: opeValInst!))
        }
    }

    func codegenBinary(op: AjisaiBinOp, left: AjisaiExpr, right: AjisaiExpr, rootIdx: UInt?) -> (
        prelude: [ACFuncBodyInst]?, valInst: ACValueInst?
    ) {
        let (leftPrelude, leftValInst) = codegen(expr: left)
        let (rightPrelude, rightValInst) = codegen(expr: right)

        var prelude: [ACFuncBodyInst]? = nil
        if leftPrelude != nil || rightPrelude != nil {
            prelude = []
            if let leftPrelude = leftPrelude {
                prelude!.append(contentsOf: leftPrelude)
            }
            if let rightPrelude = rightPrelude {
                prelude!.append(contentsOf: rightPrelude)
            }
        }

        switch op {
        case .add:
            let leftTy = left.ty
            let rightTy = right.ty
            if leftTy.tyEqual(to: .str) && rightTy.tyEqual(to: .str) {
                let tmpId = funcCtx.freshFuncTmpId
                var prelude1: [ACFuncBodyInst] = []
                prelude1.append(
                    .tmp_def(
                        envId: funcCtx.funcEnvId, tmpVarIdx: tmpId, ty: .str,
                        value: .func_call(
                            callee: .builtin_load(name: "str_concat"),
                            args: [leftValInst!, rightValInst!])))
                prelude1.append(
                    .roottable_reg(
                        envId: funcCtx.funcEnvId, rootTableIdx: rootIdx!, tmpVarIdx: tmpId))
                if prelude != nil {
                    prelude!.append(contentsOf: prelude1)
                }
                return (
                    prelude: prelude ?? prelude1,
                    valInst: .tmp_load(envId: funcCtx.funcEnvId, index: tmpId)
                )
            }
            assert(leftTy.tyEqual(to: .i32))
            assert(rightTy.tyEqual(to: .i32))
            return (prelude: prelude, valInst: .i32_add(left: leftValInst!, right: rightValInst!))
        case .sub:
            return (prelude: prelude, valInst: .i32_sub(left: leftValInst!, right: rightValInst!))
        case .mul:
            return (prelude: prelude, valInst: .i32_mul(left: leftValInst!, right: rightValInst!))
        case .div:
            return (prelude: prelude, valInst: .i32_div(left: leftValInst!, right: rightValInst!))
        case .mod:
            return (prelude: prelude, valInst: .i32_mod(left: leftValInst!, right: rightValInst!))
        case .eq:
            let leftTy = left.ty
            let rightTy = right.ty
            if leftTy.tyEqual(to: .str) && rightTy.tyEqual(to: .str) {
                return (
                    prelude: prelude,
                    valInst: .func_call(
                        callee: .builtin_load(name: "str_equal"),
                        args: [leftValInst!, rightValInst!])
                )
            }
            if leftTy.tyEqual(to: .i32) && rightTy.tyEqual(to: .i32) {
                return (
                    prelude: prelude, valInst: .i32_eq(left: leftValInst!, right: rightValInst!)
                )
            }
            if leftTy.tyEqual(to: .bool) && rightTy.tyEqual(to: .bool) {
                return (
                    prelude: prelude, valInst: .bool_eq(left: leftValInst!, right: rightValInst!)
                )
            }
            assert(leftTy.tyEqual(to: .unit))
            assert(rightTy.tyEqual(to: .unit))
            return (prelude: prelude, valInst: .bool_const(value: true))
        case .neq:
            let leftTy = left.ty
            let rightTy = right.ty
            if leftTy.tyEqual(to: .str) && rightTy.tyEqual(to: .str) {
                return (
                    prelude: prelude,
                    valInst: .bool_not(
                        operand: .func_call(
                            callee: .builtin_load(name: "str_equal"),
                            args: [leftValInst!, rightValInst!]))
                )
            }
            if leftTy.tyEqual(to: .i32) && rightTy.tyEqual(to: .i32) {
                return (
                    prelude: prelude, valInst: .i32_ne(left: leftValInst!, right: rightValInst!)
                )
            }
            if leftTy.tyEqual(to: .bool) && rightTy.tyEqual(to: .bool) {
                return (
                    prelude: prelude, valInst: .bool_ne(left: leftValInst!, right: rightValInst!)
                )
            }
            assert(leftTy.tyEqual(to: .unit))
            assert(rightTy.tyEqual(to: .unit))
            return (prelude: prelude, valInst: .bool_const(value: false))
        case .logand:
            return (prelude: prelude, valInst: .bool_and(left: leftValInst!, right: rightValInst!))
        case .logor:
            return (prelude: prelude, valInst: .bool_or(left: leftValInst!, right: rightValInst!))
        case .lt:
            return (prelude: prelude, valInst: .i32_lt(left: leftValInst!, right: rightValInst!))
        case .le:
            return (prelude: prelude, valInst: .i32_le(left: leftValInst!, right: rightValInst!))
        case .gt:
            return (prelude: prelude, valInst: .i32_gt(left: leftValInst!, right: rightValInst!))
        case .ge:
            return (prelude: prelude, valInst: .i32_ge(left: leftValInst!, right: rightValInst!))
        }
    }

    func codegenCall(callee: AjisaiExpr, calleeTy: AjisaiType, args: [AjisaiExpr], rootIdx: UInt?)
        -> (
            prelude: [ACFuncBodyInst]?, valInst: ACValueInst?
        )
    {
        var prelude: [ACFuncBodyInst] = []
        let (calleePrelude, calleeValInst) = codegen(expr: callee)
        if let calleePrelude = calleePrelude {
            prelude.append(contentsOf: calleePrelude)
        }

        var argValInsts: [ACValueInst] = []
        for arg in args {
            let (argPrelude, argValInst) = codegen(expr: arg)
            if let argPrelude = argPrelude {
                prelude.append(contentsOf: argPrelude)
            }

            switch arg {
            case let .globalVarNode(name: name, modName: _, ty: ty)
            where ty.isFunc && ty.funcKind! != .closure:
                let (staticClsPrelude, staticClsInst) = codegenStaticClosure(
                    name: name, funcKind: ty.funcKind!)
                prelude.append(contentsOf: staticClsPrelude)
                argValInsts.append(staticClsInst)
            case _ where !arg.ty.tyEqual(to: .unit):
                argValInsts.append(argValInst!)
            default:
                // unit value は引数として渡さない
                break
            }
        }

        let calleeIsFuncLiteral =
            switch calleeTy.funcKind! {
            case .closure:
                true
            default:
                switch calleeValInst! {
                case .closure_const(id: _):
                    true
                default:
                    false
                }
            }

        switch calleeTy.followLink()! {
        case let .function(kind: funcKind, argTypes: argTypes, bodyType: bodyType):
            // NOTE: funcKind が .closure 以外でもクロージャとして呼び出されている場合がある
            var valInst: ACValueInst =
                if calleeIsFuncLiteral || funcKind == .closure {
                    .closure_call(
                        callee: calleeValInst!, args: argValInsts, argTypes: argTypes,
                        bodyType: bodyType)
                } else {
                    .func_call(callee: calleeValInst!, args: argValInsts)
                }

            if bodyType.mayBeHeapObject() {
                let tmpId = funcCtx.freshFuncTmpId
                prelude.append(
                    .tmp_def(
                        envId: funcCtx.funcEnvId, tmpVarIdx: tmpId, ty: bodyType, value: valInst))
                prelude.append(
                    .roottable_reg(
                        envId: funcCtx.funcEnvId, rootTableIdx: rootIdx!, tmpVarIdx: tmpId))
                valInst = .tmp_load(envId: funcCtx.funcEnvId, index: tmpId)
            }

            return (prelude: prelude.isEmpty ? nil : prelude, valInst: valInst)
        default:
            // unreachable
            return (prelude: nil, valInst: nil)
        }
    }

    func codegenLocalVar(varName: String, envId: UInt) -> (
        prelude: [ACFuncBodyInst]?, valInst: ACValueInst?
    ) {
        (prelude: nil, valInst: .envvar_load(envId: envId, varName: varName))
    }

    func codegenGlobalVar(varName: String, modName: String, ty: AjisaiType) -> (
        prelude: [ACFuncBodyInst]?, valInst: ACValueInst?
    ) {
        switch ty {
        case let .function(kind: funcKind, argTypes: _, bodyType: _):
            switch funcKind {
            case .userdef, .closure:
                return (prelude: nil, valInst: .modval_load(modName: modName, varName: varName))
            case .builtin:
                return (prelude: nil, valInst: .builtin_load(name: varName))
            }
        default:
            return (prelude: nil, valInst: .modval_load(modName: modName, varName: varName))
        }
    }

    func codegenExprSeq(exprs: [AjisaiExpr], ty: AjisaiType) -> (
        prelude: [ACFuncBodyInst]?, valInst: ACValueInst?
    ) {
        var prelude: [ACFuncBodyInst] = []
        var valInst: ACValueInst? = nil

        for (i, expr) in exprs.enumerated() {
            let (exprPrelude, exprValInst) = codegen(expr: expr)
            if let exprPrelude = exprPrelude {
                prelude.append(contentsOf: exprPrelude)
            }
            if i == exprs.count - 1 {
                if ty.tyEqual(to: .unit) {
                    if let exprValInst = exprValInst {
                        prelude.append(.discard_value(exprValInst))
                    }
                } else {
                    valInst = exprValInst
                }
            } else {
                if let exprValInst = exprValInst {
                    prelude.append(.discard_value(exprValInst))
                }
            }
        }

        return (prelude: prelude.isEmpty ? nil : prelude, valInst: valInst)
    }

    func codegenLet(
        declares: [AjisaiVariableDeclare], body: AjisaiExpr, bodyTy: AjisaiType, envId: UInt,
        rootIdx: UInt?, rootIndices: [UInt]
    ) -> (prelude: [ACFuncBodyInst]?, valInst: ACValueInst?) {

        var prelude: [ACFuncBodyInst] = []

        let funcEnvId = funcCtx.funcEnvId
        var returnVarTmpVarIdx: UInt? = nil
        if bodyTy.mayBeHeapObject() {
            returnVarTmpVarIdx = funcCtx.freshFuncTmpId
            prelude.append(
                .tmp_def_without_value(
                    envId: funcEnvId, tmpVarIdx: returnVarTmpVarIdx!, ty: bodyTy))
        }

        for declare in declares {
            let (valPrelude, valInst) = codegen(expr: declare.value)
            if let valPrelude = valPrelude {
                prelude.append(contentsOf: valPrelude)
            }

            switch declare.value {
            case let .globalVarNode(name: name, modName: _, ty: ty)
            where ty.isFunc && ty.funcKind! != .closure:
                let (staticClsPrelude, staticClsInst) = codegenStaticClosure(
                    name: name, funcKind: ty.funcKind!)
                prelude.append(contentsOf: staticClsPrelude)
                prelude.append(
                    .envvar_def(
                        envId: envId, varName: declare.name, ty: declare.ty,
                        value: staticClsInst))
            case _ where !declare.ty.tyEqual(to: .unit):
                prelude.append(
                    .envvar_def(
                        envId: envId, varName: declare.name, ty: declare.ty, value: valInst!))
            default:
                // unit value は変数として定義しない
                break
            }
        }

        let (bodyPrelude, bodyValInst) = codegen(expr: body)
        if let bodyPrelude = bodyPrelude {
            prelude.append(contentsOf: bodyPrelude)
        }

        for idx in rootIndices {
            prelude.append(.roottable_unreg(rootTableIdx: idx))
        }

        if let tmpVarIdx = returnVarTmpVarIdx {
            prelude.append(
                .tmp_store(envId: funcEnvId, tmpVarIdx: tmpVarIdx, value: bodyValInst!))
            prelude.append(
                .roottable_reg(
                    envId: funcEnvId, rootTableIdx: rootIdx!, tmpVarIdx: tmpVarIdx))
            return (
                prelude: prelude, valInst: .tmp_load(envId: funcEnvId, index: tmpVarIdx)
            )
        } else {
            return (prelude: prelude.isEmpty ? nil : prelude, valInst: bodyValInst)
        }
    }

    func codegenIf(cond: AjisaiExpr, then: AjisaiExpr, els: AjisaiExpr, ty: AjisaiType) -> (
        prelude: [ACFuncBodyInst]?, valInst: ACValueInst?
    ) {
        var prelude: [ACFuncBodyInst] = []
        let resultTmpId = funcCtx.freshFuncTmpId
        let isUnitType = ty.tyEqual(to: .unit)

        if !isUnitType {
            prelude.append(
                .tmp_def_without_value(envId: funcCtx.funcEnvId, tmpVarIdx: resultTmpId, ty: ty))
        }

        let (condPrelude, condValInst) = codegen(expr: cond)
        if let condPrelude = condPrelude {
            prelude.append(contentsOf: condPrelude)
        }

        var thenInsts: [ACFuncBodyInst] = []
        let (thenPrelude, thenValInst) = codegen(expr: then)
        if let thenPrelude = thenPrelude {
            thenInsts.append(contentsOf: thenPrelude)
        }

        var elseInsts: [ACFuncBodyInst] = []
        let (elsePrelude, elseValInst) = codegen(expr: els)
        if let elsePrelude = elsePrelude {
            elseInsts.append(contentsOf: elsePrelude)
        }

        if isUnitType {
            if let thenValInst = thenValInst {
                thenInsts.append(.discard_value(thenValInst))
            }
            if let elseValInst = elseValInst {
                thenInsts.append(.discard_value(elseValInst))
            }
        } else {
            thenInsts.append(
                .tmp_store(envId: funcCtx.funcEnvId, tmpVarIdx: resultTmpId, value: thenValInst!))
            elseInsts.append(
                .tmp_store(envId: funcCtx.funcEnvId, tmpVarIdx: resultTmpId, value: elseValInst!))
        }

        prelude.append(.ifelse(cond: condValInst!, then: thenInsts, els: elseInsts))

        return (
            prelude: prelude,
            valInst: isUnitType ? nil : .tmp_load(envId: funcCtx.funcEnvId, index: resultTmpId)
        )
    }

    func codegenStaticClosure(name: String, funcKind: AjisaiFuncKind) -> (
        prelude: [ACFuncBodyInst], valInst: ACValueInst
    ) {
        let closureId = funcCtx.freshFuncTmpId
        return (
            prelude: [
                .closure_make_static(
                    id: closureId, funcKind: funcKind, name: name,
                    modName: funcKind == .builtin ? nil : modName)
            ],
            valInst: .closure_const(id: closureId)
        )
    }

    func codegenClosure(closureId: UInt, ty: AjisaiType, rootIdx: UInt) -> (
        prelude: [ACFuncBodyInst]?, valInst: ACValueInst?
    ) {
        let funcEnvId = funcCtx.funcEnvId
        let tmpVarId = funcCtx.freshFuncTmpId

        return (
            prelude: [
                .tmp_def(
                    envId: funcEnvId, tmpVarIdx: tmpVarId, ty: ty,
                    value: .closure_make(id: closureId)),
                .roottable_reg(envId: funcEnvId, rootTableIdx: rootIdx, tmpVarIdx: tmpVarId),
            ],
            valInst: .tmp_load(envId: funcEnvId, index: tmpVarId)
        )
    }
}

public func codeGenerate<Target>(
    analyzedAst: AjisaiImportGraphNode<AjisaiModule>, to target: inout Target
)
where Target: TextOutputStream {
    let codeGenerator = AjisaiCodeGenerator(importGraph: analyzedAst)
    let acProgram = codeGenerator.codegen()
    writeCSource(program: acProgram, to: &target)
}
