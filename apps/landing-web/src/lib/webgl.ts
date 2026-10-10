/**
 * WebGL2 on a real GPU. Software rasterisers (SwiftShader, llvmpipe, WARP)
 * cannot hold 60 fps, so scenes skip them. Probed once, lazily: the probe
 * itself costs a context.
 */
let verdict: boolean | undefined;

export function hardwareWebGL() {
  if (verdict !== undefined) return verdict;
  const gl = document.createElement("canvas").getContext("webgl2");
  if (!gl) {
    verdict = false;
    return verdict;
  }
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = info
    ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
    : "";
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  verdict =
    !/swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(
      renderer,
    );
  return verdict;
}
