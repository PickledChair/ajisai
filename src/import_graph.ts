import {
  AstModuleNode,
  AstGlobalVarNode,
  AstModuleDeclareNode,
  AstPathNode,
} from "./ast.ts";

type VisitStatus = "unvisited" | "visiting" | "visited";

type ModuleTreeNode = {
  modName: { orig: string, renamed: string },
  mod: AstModuleNode,
  subMods: ModuleTreeNode[],
  importPaths: { path: AstPathNode | AstGlobalVarNode, asName?: AstGlobalVarNode }[],
  superMod: ModuleTreeNode | undefined,
  visitStatus: VisitStatus
};

class ModuleRenamer {
  #prevModIdxs: Map<string, number> = new Map();

  renameModule(name: string): string {
    const idx = this.#prevModIdxs.get(name);
    if (idx == null) {
      this.#prevModIdxs.set(name, 0);
      return `${name}0`;
    } else  {
      const nextIdx = idx + 1;
      this.#prevModIdxs.set(name, nextIdx);
      return `${name}${nextIdx}`;
    }
  }
}

const makeModuleTree = (
  modDeclare: AstModuleDeclareNode,
  superMod: ModuleTreeNode | undefined,
  modRenamer: ModuleRenamer
): ModuleTreeNode => {
  const { name, mod } = modDeclare;

  const orig = name;
  const renamed = modRenamer.renameModule(orig);

  const moduleTree: ModuleTreeNode = {
    modName: { orig, renamed },
    mod,
    subMods: [],
    importPaths: [],
    superMod,
    visitStatus: "unvisited"
  };

  for (const item of mod.items) {
    if (item.nodeType === "import") {
      moduleTree.importPaths.push({
        path: item.path,
        asName: item.asName
      });
    } else if (item.nodeType === "def" && item.declare.nodeType === "moduleDeclare") {
      moduleTree.subMods.push(makeModuleTree(
        item.declare,
        moduleTree,
        modRenamer
      ));
    }
  }

  return moduleTree;
};

const resolvePath = (
  modTree: ModuleTreeNode,
  root: ModuleTreeNode,
  path: AstPathNode | AstGlobalVarNode
): ModuleTreeNode => {
  if (path.nodeType === "globalVar") {
    if (path.name === "package") {
      // FIXME: path に親があったらこの結果は不自然
      return root;
    } else if (path.name === "super") {
      const superMod = modTree.superMod;
      if (superMod == null) {
        throw new Error("package root module does not have super module");
      } else {
        return superMod;
      }
    } else {
      for (const subMod of modTree.subMods) {
        if (subMod.modName.orig === path.name) {
          return subMod;
        }
      }
      throw new Error(`invalid module name: ${path.name}`);
    }
  } else {
    const { sup, sub } = path;

    let startNode: ModuleTreeNode | undefined = undefined;
    if (sup === "package") {
      startNode = root;
    } else if (sup === "super") {
      if (modTree.superMod == null) {
        startNode = root;
      } else {
        startNode = modTree.superMod;
      }
    } else {
      for (const subMod of modTree.subMods) {
        if (subMod.modName.orig === sup) {
          startNode = subMod;
          break;
        }
      }
    }
    if (startNode == null) throw new Error(`invalid module name: ${sup}`);

    return resolvePath(startNode, root, sub);
  }
};

export type ImportGraphNode = {
  modName: { orig: string, renamed: string },
  mod: AstModuleNode,
  isAnalyzed: boolean,
  importMods: Map<string, ImportGraphNode>,
  importerMod?: ImportGraphNode,
};

const makeImportGraph1 = (
  current: ModuleTreeNode,
  root: ModuleTreeNode,
  importerMod?: ImportGraphNode
): ImportGraphNode => {
  if (current.visitStatus === "visiting") {
    throw new Error(`detect cycle import at ${current.modName.orig}`);
  }

  const graph: ImportGraphNode = {
    modName: current.modName,
    mod: current.mod,
    isAnalyzed: false,
    importMods: new Map(),
    importerMod
  };

  current.visitStatus = "visiting";

  for (const { path, asName } of current.importPaths) {
    const importMod = makeImportGraph1(
      resolvePath(current, root, path),
      root,
      graph
    );
    const modName = asName == null ? importMod.modName.orig : asName.name;
    graph.importMods.set(modName, importMod);
  }

  current.visitStatus = "visited";

  return graph;
};

export const makeImportGraph = (modDeclare: AstModuleDeclareNode): ImportGraphNode => {
  const modRenamer = new ModuleRenamer();
  const modTree = makeModuleTree(modDeclare, undefined, modRenamer);
  return makeImportGraph1(modTree, modTree);
};
