public struct AjisaiModule: Equatable {
    public let items: [AjisaiModuleItem]
    public let envId: UInt
    public let rootTableSize: UInt
    public let globalRootTableSize: UInt
}

public enum AjisaiModuleItem: Equatable {
    // case defNode(declare: AjisaiDeclare)
    case variableDeclare(AjisaiVariableDeclare)
    // case moduleDeclare(
    //     name: String,
    //     mod: AjisaiModule)
    case importNode(asName: String)
    case exprStmtNode(expr: AjisaiExpr)
}

public struct AjisaiVariableDeclare: Equatable {
    public let name: String
    public let ty: AjisaiType
    public let value: AjisaiExpr
    public let modName: String
    public let globalRootIdx: UInt?
}

// public enum AjisaiDeclare: Equatable {
//     case variableDeclare(
//         name: String,
//         ty: AjisaiType,
//         value: AjisaiExpr,
//         modName: String,
//         globalRootIdx: UInt?)
//     case moduleDeclare(
//         name: String,
//         mod: AjisaiModule)
// }

public struct AjisaiFuncArg: Equatable {
    public let name: String
    public let ty: AjisaiType
}

public enum AjisaiExpr: Equatable {
    case exprSeqNode(
        exprs: [AjisaiExpr],
        ty: AjisaiType)
    indirect case funcNode(
        args: [AjisaiFuncArg],
        body: AjisaiExpr,
        bodyTy: AjisaiType,
        ty: AjisaiType,
        envId: UInt,
        rootTableSize: UInt,
        closureId: UInt?,
        rootIdx: UInt?)
    indirect case letNode(
        declares: [AjisaiVariableDeclare],
        body: AjisaiExpr,
        bodyTy: AjisaiType,
        envId: UInt,
        rootIdx: UInt?,
        rootIndices: [UInt])
    indirect case ifNode(
        cond: AjisaiExpr,
        then: AjisaiExpr,
        els: AjisaiExpr,
        ty: AjisaiType)
    indirect case callNode(
        callee: AjisaiExpr,
        args: [AjisaiExpr],
        ty: AjisaiType,
        calleeTy: AjisaiType,
        rootIdx: UInt?)
    indirect case binaryNode(
        opKind: AjisaiBinOp,
        left: AjisaiExpr,
        right: AjisaiExpr,
        ty: AjisaiType,
        rootIdx: UInt?)
    indirect case unaryNode(
        opKind: AjisaiUnOp,
        operand: AjisaiExpr,
        ty: AjisaiType)
    case boolNode(value: Bool)
    case integerNode(value: UInt)
    case stringNode(value: String, len: UInt)
    case localVarNode(name: String, envId: UInt, ty: AjisaiType)
    case globalVarNode(name: String, modName: String, ty: AjisaiType)
    case unitNode

    public var ty: AjisaiType {
        switch self {
        case let .exprSeqNode(exprs: _, ty: ty):
            ty
        case let .funcNode(
            args: _,
            body: _,
            bodyTy: _,
            ty: ty,
            envId: _,
            rootTableSize: _,
            closureId: _,
            rootIdx: _):
            ty
        case let .letNode(
            declares: _,
            body: _,
            bodyTy: ty,
            envId: _,
            rootIdx: _,
            rootIndices: _):
            ty
        case let .ifNode(
            cond: _,
            then: _,
            els: _,
            ty: ty):
            ty
        case let .callNode(
            callee: _,
            args: _,
            ty: ty,
            calleeTy: _,
            rootIdx: _):
            ty
        case let .binaryNode(opKind: _, left: _, right: _, ty: ty, rootIdx: _):
            ty
        case let .unaryNode(opKind: _, operand: _, ty: ty):
            ty
        case .boolNode(value: _):
            .bool
        case .integerNode(value: _):
            .i32
        case .stringNode(value: _, len: _):
            .str
        case let .localVarNode(name: _, envId: _, ty: ty):
            ty
        case let .globalVarNode(name: _, modName: _, ty: ty):
            ty
        // case let .pathNode(path):
        //     path.ty
        case .unitNode:
            .unit
        }
    }
}

public enum AjisaiUnOp: Equatable {
    case minus, neg
}

public enum AjisaiBinOp: Equatable {
    case add, sub, mul, div, mod, eq, neq, lt, le, gt, ge, logand, logor
}
