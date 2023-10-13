import { Type } from "./type.ts";

let freshEnvId = 0;

export type EnvKind = "module" | "proc" | "let";

export class VarEnv {
  envId: number;
  parent_?: VarEnv;
  envKind: EnvKind;
  #variables: Map<string, Type> = new Map();
  // #rootIndices: number[] = [];
  #freshRootId = 0;

  constructor(envKind: EnvKind, parent?: VarEnv) {
    this.envId = freshEnvId++;
    this.parent_ = parent;
    this.envKind = envKind;
  }

  private incrementTmpId(): number {
    switch (this.envKind) {
      case "proc":
        return this.#freshRootId++;
      case "module":
        throw new Error("module level environment doesn't have root table");
      case "let":
        return this.parent_!.incrementTmpId();
    }
  }

  freshRootId(): number {
    const freshId = this.incrementTmpId();
    // this.#rootIndices.push(freshId);
    return freshId;
  }

  // get rootIndices(): number[] {
  //   return this.#rootIndices.sort((a, b) => b - a);
  // }

  get rootTableSize(): number {
    return this.#freshRootId;
  }

  getVarTyAndLevel(name: string): { ty: Type, level: number, envId: number } | undefined {
    const ty_ = this.#variables.get(name);
    if (ty_) {
      return { ty: ty_, level: 0, envId: this.envId };
    } else {
      if (this.parent_) {
        const result = this.parent_.getVarTyAndLevel(name);
        if (result) {
          const { ty, level, envId } = result;
          return { ty, level: level+1, envId };
        }
      }
    }
    return undefined;
  }

  setVarTy(name: string, ty: Type) {
    this.#variables.set(name, ty);
  }

  setVarTyWithLevel(name: string, ty: Type, level: number) {
    if (level === 0) {
      this.setVarTy(name, ty);
    } else {
      this.parent_?.setVarTyWithLevel(name, ty, level-1);
    }
  }
}
