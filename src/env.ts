import { Type } from "./type.ts";

let freshEnvId = 0;

export type EnvKind = "module" | "func" | "let";

export class VarEnv {
  envId: number;
  parent_?: VarEnv;
  envKind: EnvKind;
  #variables: Map<string, Type> = new Map();
  #rootIndices: number[] = [];
  #freshRootId = 0;

  constructor(envKind: EnvKind, parent?: VarEnv) {
    this.envId = freshEnvId++;
    this.parent_ = parent;
    this.envKind = envKind;
  }

  private incrementTmpId(): number {
    switch (this.envKind) {
      case "module":
      case "func":
        return this.#freshRootId++;
      case "let":
        return this.parent_!.incrementTmpId();
    }
  }

  freshRootId(): number {
    const freshId = this.incrementTmpId();
    this.#rootIndices.push(freshId);
    return freshId;
  }

  get rootIndices(): number[] {
    return this.#rootIndices.sort((a, b) => b - a);
  }

  get rootTableSize(): number {
    return this.#freshRootId;
  }

  getVarTy(name: string): { ty: Type, envKind: EnvKind, envId: number } | undefined {
    const ty_ = this.#variables.get(name);
    if (ty_) {
      return { ty: ty_, envKind: this.envKind, envId: this.envId };
    } else {
      if (this.parent_) {
        return this.parent_.getVarTy(name);
      }
    }
    return undefined;
  }

  setNewVarTy(name: string, ty: Type) {
    this.#variables.set(name, ty);
  }

  setVarTy(name: string, ty: Type) {
    if (this.#variables.get(name)) {
      this.#variables.set(name, ty);
    } else {
      this.parent_?.setVarTy(name, ty);
    }
  }
}
