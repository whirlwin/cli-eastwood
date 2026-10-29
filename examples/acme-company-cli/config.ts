import type { Config } from "./clewd";
import type { AcmeConfig } from "./lib/acme";

export default {
  acme: {
    slack: { defaultChannel: "#ops" },
    jira: { url: "https://acme.atlassian.net", project: "OPS" },
    ssh: {
      user: "deploy",
      jump: "bastion.acme.example",
      hosts: {
        "web-1": "10.0.1.11",
        "web-2": "10.0.1.12",
        db: "db-1.acme.internal",
      },
    },
  } satisfies AcmeConfig,
} satisfies Config;
