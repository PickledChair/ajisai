import AjisaiParser

final class ModuleRenamer {
    var prevModIdxs: [String: Int] = [:]

    public func renameModule(name: String) -> String {
        let idx = prevModIdxs[name]
        if let idx = idx {
            let nextIdx = idx + 1
            prevModIdxs[name] = nextIdx
            return "\(name)\(nextIdx)"
        } else {
            prevModIdxs[name] = 0
            return "\(name)0"
        }
    }
}

enum VisitStatus {
    case unvisited, visiting, visited
}

public enum AjisaiImportGraphError: Error {
    case superModNotFound(span: AjisaiSpan)
    case invalidModName(name: String, span: AjisaiSpan)
    case detectCycleImport(name: String, span: AjisaiSpan?)
}

final class ModuleTreeNode {
    let modName: (orig: String, renamed: String)
    let mod: AjisaiModuleNode
    var subMods: [ModuleTreeNode] = []
    var importPaths: [(path: AjisaiPathNode, asName: String?, span: AjisaiSpan)] = []
    let superMod: ModuleTreeNode?
    var visitStatus: VisitStatus = .unvisited

    init(modName: (orig: String, renamed: String), mod: AjisaiModuleNode, superMod: ModuleTreeNode?)
    {
        self.modName = modName
        self.mod = mod
        self.superMod = superMod
    }

    static func makeModuleTree(
        modDeclare: AjisaiModuleDeclareNode, superMod: ModuleTreeNode?, modRenamer: ModuleRenamer
    ) -> ModuleTreeNode? {
        let orig = modDeclare.name
        let renamed = modRenamer.renameModule(name: orig)
        let modName = (orig: orig, renamed: renamed)

        let moduleTree = ModuleTreeNode(modName: modName, mod: modDeclare.mod, superMod: superMod)

        for item in modDeclare.mod.items {
            switch item {
            case let .importNode(path: path, asName: asName, span: span):
                moduleTree.importPaths.append((path: path, asName: asName, span: span!))
            case let .moduleNode(moduleDeclare: declare, span: _):
                let subTree = makeModuleTree(
                    modDeclare: declare, superMod: moduleTree, modRenamer: modRenamer)
                if let subTree = subTree {
                    moduleTree.subMods.append(subTree)
                }
            default:
                break
            }
        }

        return moduleTree
    }

    static func resolvePath(
        modTree: ModuleTreeNode, packageRoot: ModuleTreeNode, path: AjisaiPathNode
    ) -> Result<ModuleTreeNode, AjisaiImportGraphError> {
        switch path {
        case let .pathEnd(name: gName, span: span):
            if gName == "package" {
                // FIXME: path に親があったらこの結果は不自然
                return .success(packageRoot)
            } else if gName == "super" {
                if let superMod = modTree.superMod {
                    return .success(superMod)
                } else {
                    return .failure(.superModNotFound(span: span!))
                }
            } else {
                for subMod in modTree.subMods {
                    if subMod.modName.orig == gName {
                        return .success(subMod)
                    }
                }
                return .failure(.invalidModName(name: gName, span: span!))
            }
        case let .path(sup: sup, sub: sub, supSpan: supSpan):
            var startNode: ModuleTreeNode? = nil

            if sup == "package" {
                startNode = packageRoot
            } else if sup == "super" {
                if let superMod = modTree.superMod {
                    startNode = superMod
                } else {
                    startNode = packageRoot
                }
            } else {
                for subMod in modTree.subMods {
                    if subMod.modName.orig == sup {
                        startNode = subMod
                        break
                    }
                }
            }

            guard let startNode = startNode else {
                return .failure(.invalidModName(name: sup, span: supSpan!))
            }

            return resolvePath(modTree: startNode, packageRoot: packageRoot, path: sub)
        }
    }
}

public final class AjisaiImportGraphNode<Module> {
    public let modName: (orig: String, renamed: String)
    public var mod: Module
    public var isAnalyzed: Bool = false
    public var importMods: [(name: String, node: AjisaiImportGraphNode<Module>)] = []
    public let importerMod: AjisaiImportGraphNode<Module>?

    init(
        modName: (orig: String, renamed: String), mod: Module,
        importerMod: AjisaiImportGraphNode?
    ) {
        self.modName = modName
        self.mod = mod
        self.importerMod = importerMod
    }
}

func makeImportGraph1(
    current: ModuleTreeNode, packageRoot: ModuleTreeNode,
    importerMod: AjisaiImportGraphNode<AjisaiModuleNode>?,
    importerSpan: AjisaiSpan? = nil
) -> Result<AjisaiImportGraphNode<AjisaiModuleNode>, AjisaiImportGraphError> {
    guard current.visitStatus != .visiting else {
        return .failure(.detectCycleImport(name: current.modName.orig, span: importerSpan))
    }

    let graph = AjisaiImportGraphNode(
        modName: current.modName, mod: current.mod, importerMod: importerMod)

    current.visitStatus = .visiting

    for case let (path: path, asName: asName, span: span) in current.importPaths {
        switch ModuleTreeNode.resolvePath(
            modTree: current, packageRoot: packageRoot, path: path)
        {
        case let .failure(error):
            return .failure(error)
        case let .success(current1):
            switch makeImportGraph1(
                current: current1, packageRoot: packageRoot, importerMod: graph,
                importerSpan: span)
            {
            case let .failure(error):
                return .failure(error)
            case let .success(importMod):
                let modName = asName ?? importMod.modName.orig
                graph.importMods.append((name: modName, node: importMod))
            }
        }
    }

    current.visitStatus = .visited

    return .success(graph)
}

public func makeImportGraph(modDeclare: AjisaiModuleDeclareNode) -> Result<
    AjisaiImportGraphNode<AjisaiModuleNode>, AjisaiImportGraphError
> {
    let modRenamer = ModuleRenamer()
    let modTree = ModuleTreeNode.makeModuleTree(
        modDeclare: modDeclare, superMod: nil, modRenamer: modRenamer)
    return makeImportGraph1(
        current: modTree!, packageRoot: modTree!, importerMod: nil)
}
