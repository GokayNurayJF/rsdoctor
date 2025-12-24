import { Rule, SDK } from '@rsdoctor/types';
import { getChunksByChunkIds, getChunkIdsByAsset } from './chunk';
import {
  getDependenciesByModule,
  getDependencyByPackageData,
} from './dependency';
import { logger } from 'src/logger';

export function getModulesByAsset(
  asset: SDK.AssetData,
  chunks: SDK.ChunkData[],
  modules: SDK.ModuleData[],
  filterModules?: (keyof SDK.ModuleData)[],
  checkModules?: (module: SDK.ModuleData) => boolean,
): SDK.ModuleData[] {
  const ids = getChunkIdsByAsset(asset);
  const cks = getChunksByChunkIds(ids, chunks);
  const res = getModulesByChunks(cks, modules, filterModules, checkModules);
  return res;
}

export function getModuleIdsByChunk(chunk: SDK.ChunkData) {
  const { modules = [] } = chunk;
  return modules;
}

export function getModuleIdsByModulesIds(
  moduleIds: number[],
  modules: SDK.ModuleData[],
) {
  return moduleIds
    .map((id) => modules.find((m) => m.id === id)!)
    .filter(Boolean);
}

export function getModulesByChunk(
  chunk: SDK.ChunkData,
  modules: SDK.ModuleData[],
  filterModules?: (keyof SDK.ModuleData)[],
): SDK.ModuleData[] {
  const ids = getModuleIdsByChunk(chunk);
  return ids
    .map((id) => {
      const module = modules.find((e) => e.id === id)!;
      if (filterModules && filterModules.length > 0) {
        if (!module) {
          return null as any;
        }
        const filtered: Record<string, any> = {};
        for (const key of filterModules) {
          if (module[key] !== undefined) {
            filtered[key] = module[key];
          }
        }
        return filtered as SDK.ModuleData;
      }
      return module;
    })
    .filter(Boolean);
}

export function getModulesByChunks(
  chunks: SDK.ChunkData[],
  modules: SDK.ModuleData[],
  filterModules?: (keyof SDK.ModuleData)[],
  checkModules?: (module: SDK.ModuleData) => boolean,
): SDK.ModuleData[] {
  const res: SDK.ModuleData[] = [];
  try {
    chunks.forEach((chunk) => {
      getModulesByChunk(chunk, modules, filterModules).forEach((md) => {
        if (
          (checkModules ? checkModules(md) : true) &&
          !res.filter((_m) => _m.id === md.id).length
        ) {
          res.push(md);
        }
      });
    });
  } catch (error) {
    logger.debug(error);
  }

  return res;
}

export function getModuleByDependency(
  dep: SDK.DependencyData,
  modules: SDK.ModuleData[],
) {
  return modules.find((item) => item.id === dep.module);
}

export function filterModulesAndDependenciesByPackageDeps(
  deps: Rule.DependencyWithPackageData[],
  dependencies: SDK.DependencyData[],
  modules: SDK.ModuleData[],
): Pick<SDK.ModuleGraphData, 'dependencies' | 'modules'> {
  const _dependencies: SDK.DependencyData[] = [];
  const _modules: SDK.ModuleData[] = [];

  for (let i = 0; i < deps.length; i++) {
    const dep = getDependencyByPackageData(deps[i], dependencies);
    if (dep) {
      _dependencies.push(dep);

      const module = getModuleByDependency(dep, modules);
      if (module) {
        _modules.push(module);
      }
    }
  }

  return {
    dependencies: _dependencies,
    modules: _modules,
  };
}

const getAllDependencies = (
  module: SDK.ModuleData,
  moduleMap: Map<number, SDK.ModuleData>,
  dependencyMap: Map<number, SDK.DependencyData>,
  res: Set<number>,
) => {
  if (res.has(module.id)) {
    return;
  }
  res.add(module.id);
  if (module?.modules) {
    module.modules.forEach((moduleId) => {
      getAllDependencies(
        moduleMap.get(moduleId)!,
        moduleMap,
        dependencyMap,
        res,
      );
    });
  }
  module.dependencies.forEach((dependency) => {
    const dep = dependencyMap.get(dependency);
    if (dep) {
      const targetModule = moduleMap.get(dep.originDependency);
      if (targetModule) {
        getAllDependencies(targetModule, moduleMap, dependencyMap, res);
      }
    }
  });
};

export function getModuleDetails(
  moduleId: number,
  modules: SDK.ModuleData[],
  dependencies: SDK.DependencyData[],
): SDK.ServerAPI.InferResponseType<SDK.ServerAPI.API.GetModuleDetails> {
  const module = modules.find((e) => e.id === moduleId)!;
  const directDependencies = getDependenciesByModule(module, dependencies);
  const moduleMap = new Map<number, SDK.ModuleData>();
  modules
    .filter((m) => m.chunks.length || m.concatenationModules?.length || true)
    .forEach((m) => {
      moduleMap.set(m.id, m);
    });
  const dependencyMap = new Map<number, SDK.DependencyData>();
  dependencies.forEach((d) => {
    dependencyMap.set(d.id, d);
  });

  const allDependencies = new Set<number>();
  getAllDependencies(module, moduleMap, dependencyMap, allDependencies);

  let boundSize = 0;
  const unBoundDependencies: Set<number> = new Set();
  allDependencies.forEach((id) => {
    if (id === module.id) {
      return;
    }
    const mod = moduleMap.get(id);
    const unbound = !mod?.imported
      .filter((i) => moduleMap.has(i))
      .every((i) => allDependencies.has(i));
    if (unbound) {
      getAllDependencies(mod!, moduleMap, dependencyMap, unBoundDependencies);
    }
  });
  const boundDependencies = Array.from(allDependencies)
    .filter((id) => !unBoundDependencies.has(id))
    .map((id) => {
      const mod = moduleMap.get(id);
      if (mod) {
        boundSize += mod.size.sourceSize;
        return mod;
      }
      return undefined;
    })
    .filter(Boolean) as SDK.ModuleData[];

  return {
    module,
    dependencies: directDependencies,
    allDependencies: Array.from(allDependencies).map(
      (id) => moduleMap.get(id)!,
    ),
    boundDependencies,
    boundSize: boundSize.toLocaleString(),
    allDependenciesSize: Array.from(allDependencies)
      .reduce((acc, id) => acc + (moduleMap.get(id)?.size.sourceSize ?? 0), 0)
      .toLocaleString(),
  };
}
