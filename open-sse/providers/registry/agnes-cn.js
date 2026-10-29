import agnes from "./agnes.js";

const cnUrl = (url) => url.replace("agnes-ai.com", "agnes-ai.cn");

const agnesCn = {
  ...agnes,
  id: "agnes-cn",
  alias: "agnes-cn",
  aliases: ["agnes-ai-cn"],
  uiAlias: "agnes-cn",
  display: {
    ...agnes.display,
    name: "Agnes AI CN",
    website: cnUrl(agnes.display.website),
    notice: {
      ...agnes.display.notice,
      apiKeyUrl: cnUrl(agnes.display.notice.apiKeyUrl),
    },
  },
  transport: {
    ...agnes.transport,
    baseUrl: cnUrl(agnes.transport.baseUrl),
    validateUrl: cnUrl(agnes.transport.validateUrl),
  },
  imageConfig: {
    ...agnes.imageConfig,
    baseUrl: cnUrl(agnes.imageConfig.baseUrl),
  },
};

export default agnesCn;
