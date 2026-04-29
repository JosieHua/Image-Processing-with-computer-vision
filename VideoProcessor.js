import * as THREE from "three";

export const vertexShader = `
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
precision highp float;
in vec3 position;

void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const fragmentShader = `
precision highp float;

uniform sampler2D imageTexture;
uniform int filterMode;          // 0: Box, 1: Laplacian, 2: Gaussian, 3: Median
uniform bool displayNorm;        // Laplacian
uniform bool useEightConnected;  // Laplacian
uniform int blurRadius;          // Box & Gaussian
uniform float colorScaleR;       // Box
uniform float colorScaleG;       // Box
uniform float colorScaleB;       // Box
uniform bool invertColors;       // Box
uniform float sigma;             // Gaussian
uniform bool horizontal;         // Gaussian direction toggle

out vec4 out_FragColor;

void swap(inout float a, inout float b) {
    if (a > b) {
        float temp = a;
        a = b;
        b = temp;
    }
}

void main(void) {
    ivec2 texelCoord = ivec2(gl_FragCoord.xy);
    vec4 result = vec4(0.0);

    if (filterMode == 0) {
        // --- MODE 0: BOX BLUR & COLOR SCALE ---
        vec4 sum = vec4(0.0);
        for (int i = -blurRadius; i <= blurRadius; i++) {
            for (int j = -blurRadius; j <= blurRadius; j++) {
                sum += texelFetch(imageTexture, texelCoord + ivec2(i, j), 0);
            }
        }
        float numSamples = float((blurRadius * 2 + 1) * (blurRadius * 2 + 1));
        vec3 scaledColor = (sum.rgb / numSamples) * vec3(colorScaleR, colorScaleG, colorScaleB);
        if (invertColors) scaledColor = 1.0 - scaledColor;
        result = vec4(scaledColor, 1.0);

    } else if (filterMode == 1) {
        // --- MODE 1: LAPLACIAN FILTER ---
        vec3 laplacian_rgb = vec3(0.0);
        for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
                vec3 pixel = texelFetch(imageTexture, texelCoord + ivec2(i, j), 0).rgb;
                float weight = 0.0;
                if (useEightConnected) {
                    weight = (i == 0 && j == 0) ? -8.0 : 1.0;
                } else {
                    if (i == 0 && j == 0) weight = -4.0;
                    else if (abs(i) + abs(j) == 1) weight = 1.0;
                }
                laplacian_rgb += pixel * weight;
            }
        }
        result = displayNorm ? vec4(vec3(length(laplacian_rgb)), 1.0) : vec4(abs(laplacian_rgb), 1.0);

    } else if (filterMode == 2) {
        // --- MODE 2: SEPARABLE GAUSSIAN (1D PASS) ---
        vec3 sum_rgb = vec3(0.0);
        float weightSum = 0.0;
        for (int i = -blurRadius; i <= blurRadius; i++) {
            float weight = exp(-float(i * i) / (2.0 * sigma * sigma));
            ivec2 offset = horizontal ? ivec2(i, 0) : ivec2(0, i);
            sum_rgb += texelFetch(imageTexture, texelCoord + offset, 0).rgb * weight;
            weightSum += weight;
        }
        result = vec4(sum_rgb / weightSum, 1.0);

    } else if (filterMode == 3) {
        // --- MODE 3: MEDIAN FILTER (Dynamic 3x3 or 5x5) ---
        float vR[25], vG[25], vB[25];
        int radius = (blurRadius > 2) ? 2 : 1; // 1 for 3x3, 2 for 5x5
        int count = 0;

        for(int j = -radius; j <= radius; j++) {
            for(int i = -radius; i <= radius; i++) {
                vec3 p = texelFetch(imageTexture, texelCoord + ivec2(i, j), 0).rgb;
                vR[count] = p.r; vG[count] = p.g; vB[count] = p.b;
                count++;
            }
        }

        // Sort only the elements we collected (count = 9 or 25)
        for (int i = 0; i < count; i++) {
            for (int j = 0; j < count - 1; j++) {
                swap(vR[j], vR[j+1]); swap(vG[j], vG[j+1]); swap(vB[j], vB[j+1]);
            }
        }
        // Median index: 4 for 3x3 (count 9), 12 for 5x5 (count 25)
        result = vec4(vR[count/2], vG[count/2], vB[count/2], 1.0);
    }
    out_FragColor = result;
}
`;

export class TextureProcessor {
  constructor(width, height, material) {
    this.material = material;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const options = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, type: THREE.FloatType };
    this.renderTargetH = new THREE.WebGLRenderTarget(width, height, options);
    this.renderTargetV = new THREE.WebGLRenderTarget(width, height, options);

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(quad);
  }

  process(renderer, inputTexture) {
    const mode = this.material.uniforms.filterMode.value;
    if (mode === 2) {
      this.material.uniforms.imageTexture.value = inputTexture;
      this.material.uniforms.horizontal.value = true;
      renderer.setRenderTarget(this.renderTargetH);
      renderer.render(this.scene, this.camera);

      this.material.uniforms.imageTexture.value = this.renderTargetH.texture;
      this.material.uniforms.horizontal.value = false;
      renderer.setRenderTarget(this.renderTargetV);
      renderer.render(this.scene, this.camera);
    } else {
      this.material.uniforms.imageTexture.value = inputTexture;
      renderer.setRenderTarget(this.renderTargetV);
      renderer.render(this.scene, this.camera);
    }
    renderer.setRenderTarget(null);
  }

  get outputTexture() { return this.renderTargetV.texture; }
}
