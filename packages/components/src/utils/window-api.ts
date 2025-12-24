import { Constants, SDK } from '@rsdoctor/types';
import { BaseDataLoader } from './data/base';
import { LocalServerDataLoader } from './data/local';
import { RemoteDataLoader } from './data/remote';
import { BriefDataLoader } from './data/brief';
import { fetchManifest } from './request';
import { getAPILoaderModeFromStorage } from './storage';
import { APILoaderMode4Dev } from '../constants';

let loaderPromise: Promise<BaseDataLoader> | null = null;
let loaderInstance: BaseDataLoader | null = null;

async function getLoader(): Promise<BaseDataLoader> {
  if (loaderInstance) {
    return loaderInstance;
  }

  if (loaderPromise) {
    return loaderPromise;
  }

  loaderPromise = (async () => {
    if (window[Constants.WINDOW_RSDOCTOR_TAG]) {
      console.log('[window-api] Using BriefDataLoader');
      const loader = new BriefDataLoader({ data: [] } as any);
      loaderInstance = loader;
      return loader;
    }

    const manifest = await fetchManifest();

    if (process.env.NODE_ENV === 'development') {
      const mode = getAPILoaderModeFromStorage();
      if (mode === APILoaderMode4Dev.Local) {
        console.log('[window-api] Using LocalServerDataLoader');
        const loader = new LocalServerDataLoader(manifest);
        loaderInstance = loader;
        return loader;
      }
      if (mode === APILoaderMode4Dev.Remote) {
        console.log('[window-api] Using RemoteDataLoader');
        const loader = new RemoteDataLoader(manifest);
        loaderInstance = loader;
        return loader;
      }
    }

    if (manifest.__LOCAL__SERVER__) {
      console.log('[window-api] Using LocalServerDataLoader (from manifest)');
      const loader = new LocalServerDataLoader(manifest);
      loaderInstance = loader;
      return loader;
    }

    console.log('[window-api] Using RemoteDataLoader (default)');
    const loader = new RemoteDataLoader(manifest);
    loaderInstance = loader;
    return loader;
  })();

  return loaderPromise;
}

function createAPIFunction<T extends SDK.ServerAPI.API>(
  api: T,
): (
  ...args: SDK.ServerAPI.InferRequestBodyType<T> extends void
    ? []
    : [body: SDK.ServerAPI.InferRequestBodyType<T>]
) => Promise<SDK.ServerAPI.InferResponseType<T>> {
  return async (...args: any[]) => {
    const loader = await getLoader();
    const body = args[0];
    return loader.loadAPI(api, body);
  };
}

export function initializeWindowAPI() {
  if ((window as any).__RSDOCTOR_API__) {
    console.log('[window-api] API functions already initialized');
    return;
  }

  const apiFunctions: Record<string, Function> = {};

  Object.entries(SDK.ServerAPI.API).forEach(([key, api]) => {
    const functionName = key.charAt(0).toLowerCase() + key.slice(1);
    apiFunctions[functionName] = createAPIFunction(api);
  });

  Object.entries(SDK.ServerAPI.APIExtends).forEach(([key, api]) => {
    const functionName = key.charAt(0).toLowerCase() + key.slice(1);
    apiFunctions[functionName] = createAPIFunction(api as any);
  });

  (window as any).__RSDOCTOR_API__ = apiFunctions;

  Object.entries(apiFunctions).forEach(([name, fn]) => {
    (window as any)[name] = fn;
  });

  //some helpers
  window.ms = (id: any) =>
    window.getModuleDetails({ moduleId: id }).then(console.log);
  window.cs = (id: any) =>
    window.getChunksByModuleId({ moduleId: id }).then(console.log);
  window.ci = (id: any) =>
    window
      .getAllChunkGraph()
      .then((x: { [s: string]: unknown } | ArrayLike<unknown>) =>
        Object.values(x)
          .filter((c: any) => c.id === id)
          .forEach(console.log),
      );

  console.log(
    '[window-api] Initialized API functions on window:',
    Object.keys(apiFunctions),
  );
}
