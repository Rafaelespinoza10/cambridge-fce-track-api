set -e
cd "$(dirname "$0")"

BOLD='\033[1m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'
YELLOW='\033[1;33m'; RED='\033[0;31m'; DIM='\033[2m'; NC='\033[0m'

SERVICE=""; FUNCTION=""; STAGE="dev"; LIST=false

# Debe coincidir con serverless.yml (auth) o serverless.<nombre>.yml (resto)
SERVICES=(
  activities
  auth
  evidence
  mocks
  notifications
  planning
  progress
  recommendations
  resources
  scoring
  users
)

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

# auth usa serverless.yml raíz; resto usa serverless.<service>.yml
root_config_for() {
  if [ "$1" = "auth" ]; then
    echo "serverless.yml"
  else
    echo "serverless.${1}.yml"
  fi
}

# Las funciones siguen definidas en src/infra/<service>.serverless.yml
partial_config_for() {
  echo "src/infra/${1}.serverless.yml"
}

get_functions() {
  local cfg
  cfg="$(partial_config_for "$1")"
  awk '/^functions:/{f=1;next} f && /^  [a-zA-Z][a-zA-Z0-9_-]*:/{print $1} f && /^[a-zA-Z]/{f=0}' \
    "$cfg" | tr -d ':'
}

list_services() {
  echo ""
  for svc in "${SERVICES[@]}"; do
    cfg="$(root_config_for "$svc")"
    if [ -f "$cfg" ]; then
      echo -e "${YELLOW}--service ${svc}${NC}  ${DIM}(config: ${cfg})${NC}"
    else
      echo -e "${DIM}--service ${svc}  (pendiente: falta ${cfg})${NC}"
    fi
    get_functions "$svc" | while read -r fn; do echo -e "  ${DIM}--function $fn${NC}"; done
    echo ""
  done
}

if [ "$LIST" = true ]; then list_services; exit 0; fi

if [ -n "$SERVICE" ]; then
  cfg="$(root_config_for "$SERVICE")"
  if [ ! -f "$cfg" ]; then
    echo -e "${RED}✖ No existe ${cfg}. Para crear el servicio, añade ${cfg} en la raíz del proyecto.${NC}"
    list_services; exit 1
  fi
fi

echo -e "\n${BOLD}Cambridge FCE Track API — Deploy${NC}\n${DIM}Stage: ${STAGE}${NC}\n"

# ─── Deploy una sola función ─────────────────────────────────────────────────

if [ -n "$FUNCTION" ] && [ -n "$SERVICE" ]; then
  cfg="$(root_config_for "$SERVICE")"
  echo -e "${BLUE}→ Función: ${BOLD}${FUNCTION}${NC}  ${DIM}(servicio: ${SERVICE}, config: ${cfg})${NC}\n"
  npx serverless deploy function --function "$FUNCTION" --stage "$STAGE" --config "$cfg"

# ─── Deploy servicio completo ─────────────────────────────────────────────────

elif [ -n "$SERVICE" ]; then
  cfg="$(root_config_for "$SERVICE")"
  echo -e "${BLUE}→ Servicio: ${BOLD}${SERVICE}${NC}  ${DIM}(config: ${cfg})${NC}\n"
  npx serverless deploy --stage "$STAGE" --config "$cfg"

# ─── Deploy raíz (todos los servicios implementados) ─────────────────────────

else
  echo -e "${YELLOW}→ Deploy desde serverless.yml en la raíz del repo${NC}\n"
  npx serverless deploy --stage "$STAGE"
fi

echo -e "\n${GREEN}${BOLD}✓ Deploy completado${NC}\n"
