import {
  ShaderMaterial,
  Vector2,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SUN_BLOOM_LAYER } from "./layers";
import { SUN_BLOOM_STRENGTH } from "./starEffects";

const BLOOM_RADIUS = 0.7;
const BLOOM_THRESHOLD = 0;

export type SunBloomComposers = {
  render: () => void;
  setSize: (width: number, height: number) => void;
  /** Update UnrealBloomPass strength (e.g. when switching stars). */
  setStrength: (strength: number) => void;
  dispose: () => void;
};

/**
 * Selective bloom: only objects on SUN_BLOOM_LAYER contribute to the glow,
 * then the bloom is composited over a full scene render.
 */
export function createSunBloomComposers(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
): SunBloomComposers {
  const resolution = new Vector2(
    window.innerWidth * renderer.getPixelRatio(),
    window.innerHeight * renderer.getPixelRatio(),
  );

  const bloomPass = new UnrealBloomPass(
    resolution,
    SUN_BLOOM_STRENGTH,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD,
  );

  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(new RenderPass(scene, camera));
  bloomComposer.addPass(bloomPass);

  const mixPass = new ShaderPass(
    new ShaderMaterial({
      uniforms: {
        baseTexture: { value: null },
        bloomTexture: { value: bloomComposer.readBuffer.texture },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D baseTexture;
        uniform sampler2D bloomTexture;
        varying vec2 vUv;
        void main() {
          vec4 base = texture2D(baseTexture, vUv);
          vec4 bloom = texture2D(bloomTexture, vUv);
          gl_FragColor = base + bloom;
        }
      `,
    }),
    "baseTexture",
  );
  mixPass.needsSwap = true;

  const finalComposer = new EffectComposer(renderer);
  finalComposer.addPass(new RenderPass(scene, camera));
  finalComposer.addPass(mixPass);
  finalComposer.addPass(new OutputPass());

  const setSize = (width: number, height: number) => {
    bloomComposer.setSize(width, height);
    finalComposer.setSize(width, height);
    bloomPass.resolution.set(
      width * renderer.getPixelRatio(),
      height * renderer.getPixelRatio(),
    );
  };
  setSize(window.innerWidth, window.innerHeight);

  return {
    render: () => {
      const previousLayersMask = camera.layers.mask;
      // Bloom-only pass sees just the sun layer; don't bake that into shadows.
      const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate = false;
      camera.layers.set(SUN_BLOOM_LAYER);
      bloomComposer.render();
      camera.layers.mask = previousLayersMask;
      renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
      renderer.shadowMap.needsUpdate = true;
      finalComposer.render();
    },
    setSize,
    setStrength: (strength: number) => {
      bloomPass.strength = strength;
    },
    dispose: () => {
      bloomComposer.dispose();
      finalComposer.dispose();
      mixPass.material.dispose();
    },
  };
}
