import AjisaiParser
import AjisaiUtil

public enum TVar: Equatable {
    case unbound(id: UInt, letLevel: UInt)
    case link(ty: AjisaiType)
    case generic(id: UInt)
}

public typealias TVarState = AjisaiRef<TVar>

extension AjisaiRef: Equatable where T: Equatable {
    public static func == (lhs: AjisaiRef<T>, rhs: AjisaiRef<T>) -> Bool {
        lhs.value == rhs.value
    }
}

public enum EqType: Equatable {
    case i32, bool, str, unit

    func toType() -> AjisaiType {
        switch self {
        case .unit: .unit
        case .bool: .bool
        case .str: .str
        case .i32: .i32
        }
    }

    static func from(ty: AjisaiType) -> EqType? {
        switch ty {
        case .unit: .unit
        case .bool: .bool
        case .str: .str
        case .i32: .i32
        default: nil
        }
    }
}

public typealias EqState = AjisaiRef<EqType?>

public enum AddType: Equatable {
    case i32, str

    func toType() -> AjisaiType {
        switch self {
        case .str: .str
        case .i32: .i32
        }
    }

    static func from(ty: AjisaiType) -> AddType? {
        switch ty {
        case .str: .str
        case .i32: .i32
        default: nil
        }
    }
}

public typealias AddState = AjisaiRef<AddType?>

public enum TypeError: Error {
    case occursCheckFailed
    case unmatchedTypes(ty1: String, ty2: String)
}

public enum AjisaiType: Equatable {
    case i32, bool, str, unit
    case eq(EqState)
    case add(AddState)
    case tvar(TVarState)
    indirect case function(
        kind: AjisaiFuncKind, argTypes: [AjisaiType], bodyType: AjisaiType)

    public var isFunc: Bool {
        switch self {
        case .function(kind: _, argTypes: _, bodyType: _):
            true
        default:
            false
        }
    }

    public var funcKind: AjisaiFuncKind? {
        switch self {
        case let .tvar(tvar):
            switch tvar.value {
            case let .link(ty: ty):
                ty.funcKind
            default:
                nil
            }
        case let .function(kind: kind, argTypes: _, bodyType: _):
            kind
        default:
            nil
        }
    }

    public func followLink() -> AjisaiType? {
        switch self {
        case .i32, .bool, .str, .unit, .function(kind: _, argTypes: _, bodyType: _):
            self
        case let .add(add):
            add.value?.toType()
        case let .eq(eq):
            eq.value?.toType()
        case let .tvar(tvar):
            switch tvar.value {
            case let .link(ty: ty):
                ty.followLink()
            default:
                nil
            }
        }
    }

    public func tyEqual(to other: AjisaiType) -> Bool {
        switch (self, other) {
        case (.i32, .i32), (.bool, .bool), (.str, .str), (.unit, .unit):
            return true
        case let (.eq(eqstate), other), let (other, .eq(eqstate)):
            guard let eqtype = eqstate.value else {
                return false
            }
            return other.tyEqual(to: eqtype.toType())
        case let (.add(addstate), other), let (other, .add(addstate)):
            guard let addtype = addstate.value else {
                return false
            }
            return other.tyEqual(to: addtype.toType())
        case let (.tvar(tvar), other), let (other, .tvar(tvar)):
            switch tvar.value {
            case let .link(ty: ty):
                return ty.tyEqual(to: other)
            default:
                return .tvar(tvar) == other
            }
        case (
            .function(kind: _, let argTypes1, let bodyType1),
            .function(kind: _, let argTypes2, let bodyType2)
        ):
            guard argTypes1.count == argTypes2.count else {
                return false
            }

            for (argType1, argType2) in zip(argTypes1, argTypes2) {
                guard argType1.tyEqual(to: argType2) else {
                    return false
                }
            }

            return bodyType1.tyEqual(to: bodyType2)
        default:
            return false
        }
    }

    public func cRepresentation() -> String {
        switch self {
        case .i32:
            return "int32_t"
        case .bool:
            return "bool"
        case .str:
            return "AjisaiString *"
        case .unit:
            return "void"
        case let .eq(eqstate):
            guard let eqtype = eqstate.value else {
                // FIXME: invalid conversion
                return ""
            }
            return eqtype.toType().cRepresentation()
        case let .add(addstate):
            guard let addtype = addstate.value else {
                // FIXME: invalid conversion
                return ""
            }
            return addtype.toType().cRepresentation()
        case let .tvar(tvar):
            switch tvar.value {
            case let .link(ty: ty):
                return ty.cRepresentation()
            default:
                // FIXME: invalid conversion
                return ""
            }
        case .function(_, _, _):
            return "AjisaiClosure *"
        }
    }

    // NOTE: 型推論が終了していない段階では正しい判定を返さない可能性がある。
    // false を返す場合は必ず正しいが、true を返す場合は型検査の終了後にもう一度このメソッドを
    // 呼び出して確認する必要がある
    public func mayBeHeapObject() -> Bool {
        switch self {
        case .i32, .bool, .unit:
            return false
        case .str:
            return true
        case let .eq(eqstate):
            guard let eqtype = eqstate.value else {
                return true
            }
            return eqtype.toType().mayBeHeapObject()
        case let .add(addstate):
            guard let addtype = addstate.value else {
                return true
            }
            return addtype.toType().mayBeHeapObject()
        case let .tvar(tvar):
            switch tvar.value {
            case let .link(ty: ty):
                return ty.mayBeHeapObject()
            case .unbound(id: _, letLevel: _):
                // NOTE: unbound の場合は正解がわからず、true である可能性が残っているので
                // true を返しておく
                return true
            case .generic(id: _):
                return true
            }
        default:
            return true
        }
    }
    public static func from(typeNode: AjisaiTypeNode) -> AjisaiType {
        switch typeNode {
        case .i32: return .i32
        case .bool: return .bool
        case .unit: return .unit
        case .str: return .str
        case .function(let argTypes, let bodyType):
            var argTypes1: [AjisaiType] = []
            for argType in argTypes {
                argTypes1.append(AjisaiType.from(typeNode: argType))
            }

            let bodyType1: AjisaiType = AjisaiType.from(typeNode: bodyType)

            return .function(kind: .undefined, argTypes: argTypes1, bodyType: bodyType1)
        }
    }

    public func occursIn(id: UInt) -> Bool {
        switch self {
        case .tvar(let tvar):
            switch tvar.value {
            case .unbound(id: let id1, letLevel: _):
                return id == id1
            case .link(let ty):
                return ty.occursIn(id: id)
            case .generic(id: _):
                return false
            }
        case .function(kind: _, let argTypes, let bodyType):
            for argType in argTypes {
                if argType.occursIn(id: id) {
                    return true
                }
            }
            return bodyType.occursIn(id: id)
        default:
            return false
        }
    }

    func adjustLevel(level: UInt) {
        switch self {
        case .tvar(let tvar):
            switch tvar.value {
            case .unbound(id: let id1, letLevel: let level1):
                if level < level1 {
                    tvar.value = .unbound(id: id1, letLevel: level)
                }
            case .link(let ty):
                ty.adjustLevel(level: level)
            case .generic(id: _):
                break
            }
        case .function(kind: _, let argTypes, let bodyType):
            for argType in argTypes {
                argType.adjustLevel(level: level)
            }
            bodyType.adjustLevel(level: level)
        default:
            break
        }
    }

    public func unify(with other: AjisaiType) -> Result<(), TypeError> {
        switch (self, other) {
        case (_, _) where self == other:
            return .success(())
        case (
            .function(kind: _, let argTypes1, let bodyType1),
            .function(kind: _, let argTypes2, let bodyType2)
        ):
            for (argType1, argType2) in zip(argTypes1, argTypes2) {
                switch argType1.unify(with: argType2) {
                case .failure(let err):
                    return .failure(err)
                default:
                    break
                }
            }
            return bodyType1.unify(with: bodyType2)
        case (.tvar(let tvar), let ty), (let ty, .tvar(let tvar)):
            switch tvar.value {
            case .link(ty: let ty2):
                return ty.unify(with: ty2)
            case .unbound(let id, letLevel: let level):
                if ty.occursIn(id: id) {
                    return .failure(.occursCheckFailed)
                } else {
                    ty.adjustLevel(level: level)
                    tvar.value = .link(ty: ty)
                    return .success(())
                }
            case .generic(id: _):
                return .failure(.unmatchedTypes(ty1: "\(self)", ty2: "\(other)"))
            }
        case (.eq(let eqstate), let ty), (let ty, .eq(let eqstate)):
            switch ty {
            case .i32, .str, .bool, .unit:
                if let eqtype = eqstate.value {
                    return eqtype.toType().unify(with: ty)
                } else {
                    eqstate.value = EqType.from(ty: ty)
                    return .success(())
                }
            default:
                return .failure(.unmatchedTypes(ty1: "\(self)", ty2: "\(other)"))
            }
        case (.add(let addstate), let ty), (let ty, .add(let addstate)):
            switch ty {
            case .i32, .str:
                if let addtype = addstate.value {
                    return addtype.toType().unify(with: ty)
                } else {
                    addstate.value = AddType.from(ty: ty)
                    return .success(())
                }
            default:
                return .failure(.unmatchedTypes(ty1: "\(self)", ty2: "\(other)"))
            }
        default:
            return .failure(.unmatchedTypes(ty1: "\(self)", ty2: "\(other)"))
        }
    }
}

public enum AjisaiFuncKind: Equatable {
    case userdef, closure, builtin, undefined
}
