import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HOST_AGENT_CONTRACT_PROTOCOL = 1;

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PACKAGE_ROOT = resolve(HERE, "../../../..");

export class HostAgentContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HostAgentContractError";
    this.code = code;
  }
}

function readInstalled(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new HostAgentContractError("contract_unavailable",
      "The installed Foundation agent contract is unavailable.");
  }
}

export function resolveHostAgentContract(options = {}) {
  const packageRoot = options.packageRoot || DEFAULT_PACKAGE_ROOT;
  const protocol = Number(options.protocol ?? HOST_AGENT_CONTRACT_PROTOCOL);
  if (protocol !== HOST_AGENT_CONTRACT_PROTOCOL)
    throw new HostAgentContractError("unsupported_protocol",
      `Host agent-contract protocol '${options.protocol}' is not supported.`);

  const contract = readInstalled(join(packageRoot, ".claude", "harness", "AGENT.md"));
  const foundationVersion = readInstalled(join(packageRoot, "VERSION")).trim();
  if (!contract.trim() || !foundationVersion)
    throw new HostAgentContractError("contract_unavailable",
      "The installed Foundation agent contract is incomplete.");

  return { protocol: HOST_AGENT_CONTRACT_PROTOCOL, contract, foundationVersion };
}

export function parseHostAgentContractArguments(argv) {
  const args = [...argv];
  const options = { protocol: HOST_AGENT_CONTRACT_PROTOCOL, format: "json" };
  while (args.length) {
    const flag = args.shift();
    if (!["--protocol", "--format"].includes(flag) || !args.length)
      throw new HostAgentContractError("invalid_host_request",
        "Expected --protocol or --format followed by a value.");
    const value = args.shift();
    if (flag === "--protocol") options.protocol = value;
    if (flag === "--format") options.format = value;
  }
  if (options.format !== "json")
    throw new HostAgentContractError("unsupported_format", "Only JSON output is supported.");
  return options;
}

export function hostAgentContractResponse(argv, options = {}) {
  try {
    const parsed = parseHostAgentContractArguments(argv);
    return { status: 0, body: resolveHostAgentContract(
      { ...parsed, packageRoot: options.packageRoot }) };
  } catch (error) {
    const known = error instanceof HostAgentContractError;
    return {
      status: 1,
      body: {
        protocol: HOST_AGENT_CONTRACT_PROTOCOL,
        error: {
          code: known ? error.code : "contract_unavailable",
          message: known ? error.message : "The installed Foundation agent contract is unavailable."
        }
      }
    };
  }
}

function main() {
  const result = hostAgentContractResponse(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result.body)}\n`);
  process.exitCode = result.status;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)))
  main();
