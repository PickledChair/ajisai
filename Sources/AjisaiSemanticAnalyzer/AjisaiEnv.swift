import AjisaiUtil

enum AjisaiEnvKind: Equatable {
    case builtin, module, fn, let_
}

final class AjisaiEnv {
    public let envId: UInt
    public let parent: AjisaiEnv?
    public let envKind: AjisaiEnvKind

    var variables: [String: AjisaiType] = [:]
    var __rootIndices: [UInt] = []
    var rootIdState: AjisaiRef<UInt> = AjisaiRef(0)

    var rootTableSize: UInt {
        return rootIdState.value
    }

    var rootIndices: [UInt] {
        return __rootIndices.sorted()
    }

    init(envId: UInt, envKind: AjisaiEnvKind, parent: AjisaiEnv? = nil) {
        self.envId = envId
        self.envKind = envKind
        self.parent = parent
    }

    func incrementTmpId() -> UInt? {
        switch envKind {
        case .module, .fn:
            rootIdState.increment()
        case .let_:
            parent!.incrementTmpId()
        case .builtin:
            nil
        }
    }

    func freshRootId() -> UInt {
        let freshId = incrementTmpId()!
        __rootIndices.append(freshId)
        return freshId
    }

    func getVarTy(name: String) -> (ty: AjisaiType, envKind: AjisaiEnvKind, envId: UInt)? {
        let ty = variables[name]
        if let ty = ty {
            return (ty: ty, envKind: envKind, envId: envId)
        } else if let parent = parent {
            return parent.getVarTy(name: name)
        } else {
            return nil
        }
    }

    func addNewVarTy(name: String, ty: AjisaiType) {
        variables[name] = ty
    }

    func setVarTy(name: String, ty: AjisaiType) {
        if variables[name] == nil {
            parent?.setVarTy(name: name, ty: ty)
        } else {
            variables[name] = ty
        }
    }
}
