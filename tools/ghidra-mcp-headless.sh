#!/usr/bin/env bash
set -euo pipefail

ghidra_dir=/home/dorij/.local/opt/ghidra_12.1.2_PUBLIC
java_bin=/home/dorij/.local/opt/temurin-21.0.12.1+1/bin/java
mcp_jar=/home/dorij/.local/share/ghidra-mcp-v6.0.0/target/GhidraMCP-6.0.0.jar
workspace_dir=/home/dorij/ghidra-workspace
project_file=$workspace_dir/projects/dw2003.gpr
program_path=/dw2003-main-1dec77d0.bin

mkdir -p "$workspace_dir"

classpath=$mcp_jar
for jar_path in \
  "$ghidra_dir"/Ghidra/Framework/*/lib/*.jar \
  "$ghidra_dir"/Ghidra/Features/*/lib/*.jar \
  "$ghidra_dir"/Ghidra/Processors/*/lib/*.jar; do
  if [[ -f "$jar_path" ]]; then
    classpath="${classpath}:${jar_path}"
  fi
done

export GHIDRA_MCP_ALLOW_SCRIPTS=0
export GHIDRA_MCP_FILE_ROOT=$workspace_dir

server_args=(
  --bind 127.0.0.1
  --port 8089
)
if [[ -f "$project_file" ]]; then
  server_args+=(--project "$project_file" --program "$program_path")
fi

exec taskset -c 0 prlimit --as=4294967296 -- "$java_bin" \
  -Xmx1g \
  -XX:CompressedClassSpaceSize=64m \
  -XX:MaxMetaspaceSize=256m \
  -XX:MaxDirectMemorySize=256m \
  -XX:ReservedCodeCacheSize=128m \
  -XX:+UseG1GC \
  -Dghidra.home="$ghidra_dir" \
  -Dapplication.name=GhidraMCP \
  -classpath "$classpath" \
  com.xebyte.headless.GhidraMCPHeadlessServer \
  "${server_args[@]}" \
  "$@"
