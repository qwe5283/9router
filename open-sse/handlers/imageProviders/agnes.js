// Agnes uses nested extra_body fields rather than the OpenAI image wire format.
import { PROVIDER_MEDIA } from "../../providers/index.js";
import createOpenAIAdapter from "./openai.js";

const config = PROVIDER_MEDIA.agnes.imageConfig;

const agnes = {
  ...createOpenAIAdapter("agnes"),
  buildBody: (model, body) => {
    if (body.n !== undefined && body.n !== 1) {
      throw new Error("Agnes image generation supports one image per request (n=1)");
    }

    const size = !body.size || body.size === "auto" ? config.defaultSize : body.size;
    if (typeof size !== "string" || (!config.sizes.includes(size) && !/^[1-9]\d*x[1-9]\d*$/.test(size))) {
      throw new Error("Agnes size must be 1K, 2K, 3K, 4K, or an exact size such as 1024x768");
    }
    const ratio = body.ratio ?? (config.sizes.includes(size) ? config.defaultRatio : undefined);
    if (ratio !== undefined && !config.ratios.includes(ratio)) {
      throw new Error(`Agnes ratio must be one of: ${config.ratios.join(", ")}`);
    }

    const source = body.extra_body?.image ?? body.image;
    const images = source === undefined ? undefined : (Array.isArray(source) ? source : [source]);
    if (images && (!images.length || images.some((value) => typeof value !== "string" || !value.trim()))) {
      throw new Error("Agnes image must contain one or more image URLs or Data URIs");
    }

    const format = body.response_format ?? body.extra_body?.response_format ?? (body.return_base64 ? "b64_json" : "url");
    if (format !== "url" && format !== "b64_json") {
      throw new Error("Agnes response_format must be url or b64_json");
    }

    return {
      model,
      prompt: body.prompt,
      size,
      ...(ratio !== undefined ? { ratio } : {}),
      ...(format === "b64_json" && !images ? { return_base64: true } : {}),
      extra_body: {
        ...(images ? { image: images } : {}),
        response_format: format,
      },
    };
  },
};

export default agnes;
