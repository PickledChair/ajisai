public struct AjisaiModuleNode {
    public let items: [AjisaiModuleItemNode]
    public let span: AjisaiSpan?

    public init(items: [AjisaiModuleItemNode], span: AjisaiSpan? = nil) {
        self.items = items
        self.span = span
    }
}

extension AjisaiModuleNode: Equatable {
    public static func == (lhs: AjisaiModuleNode, rhs: AjisaiModuleNode) -> Bool {
        lhs.items == rhs.items
    }
}

public enum AjisaiModuleItemNode {
    case moduleNode(moduleDeclare: AjisaiModuleDeclareNode, span: AjisaiSpan? = nil)
    case valNode(declare: AjisaiTypedVariableDeclareNode)
    case funcNode(funcDef: AjisaiFuncDefNode)
    case importNode(path: AjisaiPathNode, asName: String? = nil, span: AjisaiSpan? = nil)
    case exprStmtNode(expr: AjisaiExprNode, span: AjisaiSpan? = nil)
    case structDefNode(structDeclare: AjisaiStructDeclareNode)

    public var span: AjisaiSpan? {
        return switch self {
        case let .moduleNode(moduleDeclare: _, span: span):
            span
        case let .valNode(declare):
            declare.span
        case let .funcNode(funcDef):
            funcDef.span
        case let .importNode(path: _, asName: _, span: span):
            span
        case let .exprStmtNode(expr: _, span: span):
            span
        case let .structDefNode(structDeclare):
            structDeclare.span
        }
    }
}

extension AjisaiModuleItemNode: Equatable {
    public static func == (lhs: AjisaiModuleItemNode, rhs: AjisaiModuleItemNode) -> Bool {
        switch (lhs, rhs) {
        case let (
            .moduleNode(moduleDeclare: lmodDec, span: _),
            .moduleNode(moduleDeclare: rmodDec, span: _)
        ):
            lmodDec == rmodDec
        case let (.valNode(declare: ldeclare), .valNode(declare: rdeclare)):
            ldeclare == rdeclare
        case let (.funcNode(funcDef: lfuncDef), .funcNode(funcDef: rfuncDef)):
            lfuncDef == rfuncDef
        case let (
            .importNode(path: lpath, asName: lasName, span: _),
            .importNode(path: rpath, asName: rasName, span: _)
        ):
            lpath == rpath && lasName == rasName
        case let (.exprStmtNode(expr: lexpr, span: _), .exprStmtNode(expr: rexpr, span: _)):
            lexpr == rexpr
        case let (.structDefNode(structDec1), .structDefNode(structDec2)):
            structDec1 == structDec2
        default:
            false
        }
    }
}

public struct AjisaiStructDeclareNode {
    public let name: String
    public let fields: [(name: String, ty: AjisaiTypeNode, span: AjisaiSpan?)]
    public let span: AjisaiSpan?

    public init(
        name: String, fields: [(name: String, ty: AjisaiTypeNode, span: AjisaiSpan?)],
        span: AjisaiSpan? = nil
    ) {
        self.name = name
        self.fields = fields
        self.span = span
    }
}

extension AjisaiStructDeclareNode: Equatable {
    public static func == (lhs: AjisaiStructDeclareNode, rhs: AjisaiStructDeclareNode) -> Bool {
        guard lhs.name == rhs.name else {
            return false
        }
        for ((name1, ty1, _), (name2, ty2, _)) in zip(lhs.fields, rhs.fields) {
            guard name1 == name2 && ty1.tyEqual(to: ty2) else {
                return false
            }
        }
        return true
    }
}

public struct AjisaiModuleDeclareNode {
    public let name: String
    public let mod: AjisaiModuleNode
    public let span: AjisaiSpan?

    public init(name: String, mod: AjisaiModuleNode, span: AjisaiSpan? = nil) {
        self.name = name
        self.mod = mod
        self.span = span
    }
}

extension AjisaiModuleDeclareNode: Equatable {
    public static func == (lhs: AjisaiModuleDeclareNode, rhs: AjisaiModuleDeclareNode) -> Bool {
        lhs.name == rhs.name && lhs.mod == rhs.mod
    }
}

public struct AjisaiVariableDeclareNode {
    public let name: String
    public let ty: AjisaiTypeNode?
    public let value: AjisaiExprNode
    public let span: AjisaiSpan?

    public init(
        name: String, ty: AjisaiTypeNode? = nil, value: AjisaiExprNode, span: AjisaiSpan? = nil
    ) {
        self.name = name
        self.ty = ty
        self.value = value
        self.span = span
    }
}

extension AjisaiVariableDeclareNode: Equatable {
    public static func == (lhs: AjisaiVariableDeclareNode, rhs: AjisaiVariableDeclareNode)
        -> Bool
    {
        let tyEq =
            if let ty1 = lhs.ty, let ty2 = rhs.ty {
                ty1.tyEqual(to: ty2)
            } else {
                lhs.ty == nil && rhs.ty == nil
            }
        return lhs.name == rhs.name && lhs.value == rhs.value && tyEq
    }
}

public struct AjisaiTypedVariableDeclareNode {
    public let name: String
    public let ty: AjisaiTypeNode
    public let value: AjisaiExprNode
    public let span: AjisaiSpan?

    public init(name: String, ty: AjisaiTypeNode, value: AjisaiExprNode, span: AjisaiSpan? = nil) {
        self.name = name
        self.ty = ty
        self.value = value
        self.span = span
    }
}

extension AjisaiTypedVariableDeclareNode: Equatable {
    public static func == (
        lhs: AjisaiTypedVariableDeclareNode, rhs: AjisaiTypedVariableDeclareNode
    ) -> Bool {
        lhs.name == rhs.name && lhs.ty.tyEqual(to: rhs.ty)
            && lhs.value == rhs.value
    }
}

public struct AjisaiFuncDefNode {
    public let name: String
    public let value: AjisaiExprNode
    public let span: AjisaiSpan?

    public init(name: String, value: AjisaiExprNode, span: AjisaiSpan? = nil) {
        self.name = name
        self.value = value
        self.span = span
    }
}

extension AjisaiFuncDefNode: Equatable {
    public static func == (funcDef1: AjisaiFuncDefNode, funcDef2: AjisaiFuncDefNode) -> Bool {
        funcDef1.name == funcDef2.name && funcDef1.value == funcDef2.value
    }
}

public enum AjisaiPathNode {
    case pathEnd(name: String, span: AjisaiSpan? = nil)
    indirect case path(sup: String, sub: AjisaiPathNode, supSpan: AjisaiSpan? = nil)

    public var span: AjisaiSpan? {
        var span: AjisaiSpan? = nil
        var cur = self
        mergeLoop: while true {
            switch cur {
            case let .pathEnd(name: _, span: curSpan):
                if let curSpan = curSpan {
                    span = span?.merge(with: curSpan) ?? curSpan
                } else {
                    return nil
                }
                break mergeLoop
            case let .path(sup: _, sub: sub, supSpan: curSpan):
                if let curSpan = curSpan {
                    span = span?.merge(with: curSpan) ?? curSpan
                } else {
                    return nil
                }
                cur = sub
            }
        }
        return span
    }

    public func append(path: AjisaiPathNode) -> AjisaiPathNode {
        switch self {
        case let .pathEnd(name: supName, span: _):
            .path(sup: supName, sub: path)
        case let .path(sup: sup, sub: subPath, supSpan: _):
            .path(sup: sup, sub: subPath.append(path: path))
        }
    }

    public func lastName() -> String {
        switch self {
        case let .pathEnd(name: name, span: _):
            return name
        case let .path(sup: _, sub: sub, supSpan: _):
            return sub.lastName()
        }
    }
}

extension AjisaiPathNode: Equatable {
    public static func == (lhs: AjisaiPathNode, rhs: AjisaiPathNode) -> Bool {
        switch (lhs, rhs) {
        case let (.pathEnd(name: lname, span: _), .pathEnd(name: rname, span: _)):
            lname == rname
        case let (.path(sup: lsup, sub: lsub, supSpan: _), .path(sup: rsup, sub: rsub, supSpan: _)):
            lsup == rsup && lsub == rsub
        default:
            false
        }
    }
}

public enum AjisaiLetDeclareNode {
    case variableDeclare(declare: AjisaiVariableDeclareNode)
    case funcDeclare(funcDef: AjisaiFuncDefNode)
}

extension AjisaiLetDeclareNode: Equatable {
    public static func == (lhs: AjisaiLetDeclareNode, rhs: AjisaiLetDeclareNode) -> Bool {
        switch (lhs, rhs) {
        case let (.variableDeclare(declare: ldeclare), .variableDeclare(declare: rdeclare)):
            ldeclare == rdeclare
        case let (.funcDeclare(funcDef: lfuncDef), .funcDeclare(funcDef: rfuncDef)):
            lfuncDef == rfuncDef
        default:
            false
        }
    }
}

public enum AjisaiExprNode {
    case exprSeqNode(
        exprs: [AjisaiExprNode],
        span: AjisaiSpan? = nil)
    indirect case fnExprNode(
        args: [(name: String, ty: AjisaiTypeNode?, span: AjisaiSpan?)],
        body: AjisaiExprNode,
        bodyTy: AjisaiTypeNode? = nil,
        span: AjisaiSpan? = nil)
    indirect case letNode(
        declares: [AjisaiLetDeclareNode],
        body: AjisaiExprNode,
        span: AjisaiSpan? = nil)
    indirect case ifNode(
        cond: AjisaiExprNode,
        then: AjisaiExprNode,
        els: AjisaiExprNode,
        span: AjisaiSpan? = nil)
    indirect case callNode(
        callee: AjisaiExprNode,
        args: [AjisaiExprNode],
        span: AjisaiSpan? = nil)
    indirect case binaryNode(
        opKind: AjisaiBinOpKind,
        left: AjisaiExprNode,
        right: AjisaiExprNode,
        span: AjisaiSpan? = nil)
    indirect case unaryNode(
        opKind: AjisaiUnOpKind,
        operand: AjisaiExprNode,
        span: AjisaiSpan? = nil)
    case boolNode(value: Bool, span: AjisaiSpan? = nil)
    case integerNode(value: UInt, span: AjisaiSpan? = nil)
    case stringNode(value: String, span: AjisaiSpan? = nil)
    case variableNode(name: String, span: AjisaiSpan? = nil)
    case pathNode(AjisaiPathNode)
    case unitNode(span: AjisaiSpan? = nil)

    public var span: AjisaiSpan? {
        switch self {
        case let .exprSeqNode(exprs: _, span: span):
            span
        case let .fnExprNode(
            args: _,
            body: _,
            bodyTy: _,
            span: span):
            span
        case let .letNode(
            declares: _,
            body: _,
            span: span):
            span
        case let .ifNode(
            cond: _,
            then: _,
            els: _,
            span: span):
            span
        case let .callNode(
            callee: _,
            args: _,
            span: span):
            span
        case let .binaryNode(opKind: _, left: _, right: _, span: span):
            span
        case let .unaryNode(opKind: _, operand: _, span: span):
            span
        case let .boolNode(value: _, span: span):
            span
        case let .integerNode(value: _, span: span):
            span
        case let .stringNode(value: _, span: span):
            span
        case let .variableNode(name: _, span: span):
            span
        case let .pathNode(path):
            path.span
        case let .unitNode(span: span):
            span
        }
    }
}

extension AjisaiExprNode: Equatable {
    public static func == (lhs: AjisaiExprNode, rhs: AjisaiExprNode) -> Bool {
        switch (lhs, rhs) {
        case let (
            .exprSeqNode(exprs: exprs1, span: _),
            .exprSeqNode(exprs: exprs2, span: _)
        ):
            return exprs1 == exprs2
        case let (
            .fnExprNode(args: args1, body: body1, bodyTy: bodyTy1, span: _),
            .fnExprNode(args: args2, body: body2, bodyTy: bodyTy2, span: _)
        ):
            for ((argName1, argTy1, _), (argName2, argTy2, _)) in zip(args1, args2) {
                if argName1 != argName2
                    || ((argTy1 != nil && argTy2 != nil) && !argTy1!.tyEqual(to: argTy2!))
                {
                    return false
                }
            }
            return body1 == body2
                && ((bodyTy1 != nil && bodyTy2 != nil)
                    ? bodyTy1!.tyEqual(to: bodyTy2!) : (bodyTy1 == nil && bodyTy2 == nil))
        case let (
            .letNode(declares: declares1, body: body1, span: _),
            .letNode(declares: declares2, body: body2, span: _)
        ):
            return declares1 == declares2 && body1 == body2
        case let (
            .ifNode(cond: cond1, then: then1, els: els1, span: _),
            .ifNode(cond: cond2, then: then2, els: els2, span: _)
        ):
            return cond1 == cond2 && then1 == then2 && els1 == els2
        case let (
            .callNode(callee: callee1, args: args1, span: _),
            .callNode(callee: callee2, args: args2, span: _)
        ):
            return callee1 == callee2 && args1 == args2
        case let (
            .binaryNode(opKind: opKind1, left: left1, right: right1, span: _),
            .binaryNode(opKind: opKind2, left: left2, right: right2, span: _)
        ):
            return opKind1 == opKind2 && left1 == left2 && right1 == right2
        case let (
            .unaryNode(opKind: opKind1, operand: operand1, span: _),
            .unaryNode(opKind: opKind2, operand: operand2, span: _)
        ):
            return opKind1 == opKind2 && operand1 == operand2
        case let (.boolNode(value: val1, span: _), .boolNode(value: val2, span: _)):
            return val1 == val2
        case let (.integerNode(value: val1, span: _), .integerNode(value: val2, span: _)):
            return val1 == val2
        case let (.stringNode(value: val1, span: _), .stringNode(value: val2, span: _)):
            return val1 == val2
        case let (
            .variableNode(name: name1, span: _),
            .variableNode(name: name2, span: _)
        ):
            return name1 == name2
        case let (.pathNode(path1), .pathNode(path2)):
            return path1 == path2
        case (.unitNode(span: _), .unitNode(span: _)):
            return true
        default:
            return false
        }
    }
}

public enum AjisaiUnOpKind: Equatable {
    case minus, neg
}

public enum AjisaiBinOpKind: Equatable {
    case add, sub, mul, div, mod, eq, neq, lt, le, gt, ge, logand, logor
}

public enum AjisaiTypeNode: Equatable {
    case i32, bool, str, unit
    indirect case function(argTypes: [AjisaiTypeNode], bodyType: AjisaiTypeNode)

    public func tyEqual(to other: AjisaiTypeNode) -> Bool {
        switch (self, other) {
        case (.i32, .i32), (.bool, .bool), (.str, .str), (.unit, .unit):
            return true
        case (.function(let argTypes1, let bodyType1), .function(let argTypes2, let bodyType2)):
            guard argTypes1.count == argTypes2.count else {
                return false
            }

            for (argTy1, argTy2) in zip(argTypes1, argTypes2) {
                guard argTy1.tyEqual(to: argTy2) else {
                    return false
                }
            }

            guard bodyType1.tyEqual(to: bodyType2) else {
                return false
            }

            return true
        default:
            return false
        }
    }

    public static func convertToPrimitiveType(from ident: String) -> AjisaiTypeNode? {
        switch ident {
        case "i32":
            return .i32
        case "bool":
            return .bool
        case "str":
            return .str
        case "()":
            return .unit
        default:
            return nil
        }
    }
}
