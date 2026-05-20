set -e
cd "$(dirname "$0")"

BOLD='\033[1m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'
YELLOW='\033[1;33m'; RED='\033[0;31m'; DIM='\033[2m'; NC='\033[0m'

SERVICE=""; FUNCTION=""; STAGE="dev"; LIST=false
PATH_MAP="serverless.path-map.conf"

map_service_names() {
  awk -F= '!/^[[:space:]]*#/ && NF==2 {gsub(/[[:space:]]/,"",$1); print $1}' "$PATH_MAP"
}

SERVICES=()
while IFS= read -r name; do
  SERVICES+=("$name")
done < <(map_service_names)

while [[ "$#" -gt 0 ]]; do
  case $1 in
    --service)  SERVICE="$2";  shift ;;
    --function) FUNCTION="$2"; shift ;;
    --stage)    STAGE="$2";    shift ;;
    --list)     LIST=true ;;
    *) echo -e "${RED}✖ Argumento desconocido: $1${NC}"; exit 1 ;;
  esac
  shift
done

config_file_for() {
  echo "src/infra/${1}.serverless.yml"
}

get_functions() {
  local cfg
  cfg="$(config_file_for "$1")"
  awk '/^functions:/{f=1;next} f && /^  [a-zA-Z][a-zA-Z0-9_-]*:/{print $1} f && /^[a-zA-Z]/{f=0}' \
    "$cfg" | tr -d ':'
}

list_services() {
  echo ""
  for svc in "${SERVICES[@]}"; do
    echo -e "${YELLOW}--service ${svc}${NC}"
    get_functions "$svc" | while read -r fn; do echo -e "  ${DIM}--function $fn${NC}"; done
    echo ""
  done
}

if [ "$LIST" = true ]; then list_services; exit 0; fi

if [ -n "$SERVICE" ] && [ ! -f "$(config_file_for "$SERVICE")" ]; then
  echo -e "${RED}✖ No existe $(config_file_for "$SERVICE")${NC}"
  list_services; exit 1
fi

echo -e "\n${BOLD}Cambridge FCE Track API — Deploy${NC}\n${DIM}Stage: ${STAGE}${NC}\n"

# Copia temporal al root para satisfacer la restricción de Serverless v3
sls_deploy() {
  local src_cfg tmp_cfg
  src_cfg="$(config_file_for "$1")"
  tmp_cfg="_$(basename "$src_cfg" .serverless.yml)_tmp.serverless.yml"
  cp "$src_cfg" "$tmp_cfg"
  trap "rm -f '$tmp_cfg'" EXIT
  shift
  npx serverless "$@" --config "$tmp_cfg" --stage "$STAGE"
  local exit_code=$?
  rm -f "$tmp_cfg"
  trap - EXIT
  return $exit_code
}

# ─── Deploy una sola función ─────────────────────────────────────────────────

if [ -n "$FUNCTION" ] && [ -n "$SERVICE" ]; then
  echo -e "${BLUE}→ Función: ${BOLD}${FUNCTION}${NC}  ${DIM}(servicio: ${SERVICE})${NC}\n"
  sls_deploy "$SERVICE" deploy function --function "$FUNCTION"

# ─── Deploy servicio completo (todas las Lambdas de ese YAML) ───────────────

elif [ -n "$SERVICE" ]; then
  echo -e "${BLUE}→ Servicio: ${BOLD}${SERVICE}${NC}  ${DIM}(stack completo: $(config_file_for "$SERVICE"))${NC}\n"
  sls_deploy "$SERVICE" deploy

# ─── Deploy raíz (serverless.yml del proyecto) ──────────────────────────────

else
  echo -e "${YELLOW}→ Deploy desde serverless.yml en la raíz del repo${NC}\n"
  npx serverless deploy --stage "$STAGE"
fi

echo -e "\n${GREEN}${BOLD}✓ Deploy completado${NC}\n"
