# Deploy do back-end do CUIDA na Oracle Cloud (Always Free)

Objetivo: back-end + Evolution API (WhatsApp) rodando 24h numa VM grátis, com HTTPS, sem depender de nenhum PC ligado. O Supabase continua onde está.

```
Internet ──HTTPS──► Caddy (80/443) ──► api (Node, porta 3000) ──► Supabase (nuvem)
                                            │
                                            └──► evolution (8080, só interno) ──► WhatsApp
                                                     └──► evolution-db (Postgres: guarda a sessão)
```

Arquivos usados (pasta `Back-End/`):

| Arquivo | Para quê |
|---|---|
| `Dockerfile` | imagem do back-end (funciona em ARM, que é a VM grátis da Oracle) |
| `deploy/docker-compose.prod.yml` | sobe api + Evolution + Postgres + Caddy |
| `deploy/Caddyfile` | HTTPS automático (Let's Encrypt) |
| `deploy/.env.example` | modelo das variáveis; na VM vira `deploy/.env` (nunca vai para o git) |

Tempo estimado: 1 a 2 horas na primeira vez.

---

## 1. Criar a conta na Oracle Cloud

1. Acesse [oracle.com/cloud/free](https://www.oracle.com/cloud/free/) → **Start for free**.
2. Preencha os dados. O **cartão de crédito é só verificação**: recursos "Always Free" não são cobrados.
3. **Home Region:** escolha **Brazil East (São Paulo)** ou **Brazil Southeast (Vinhedo)**. Ela **não pode ser trocada depois**, e as VMs grátis só existem na home region.
4. Espere o e-mail de conta ativa (pode levar alguns minutos).

> Desde 15/06/2026 o limite grátis da VM ARM é **2 OCPUs e 12 GB de RAM** (antes era 4/24). É suficiente para o CUIDA.

## 2. Criar a VM

Menu ☰ → **Compute → Instances → Create instance**.

| Campo | Valor |
|---|---|
| Name | `cuida` |
| Image | **Ubuntu 24.04** (Canonical) — clique em *Change image* |
| Shape | *Change shape* → **Ampere** → `VM.Standard.A1.Flex` → **2 OCPUs, 12 GB** |
| Networking | *Create new virtual cloud network* + *public subnet*; **Assign a public IPv4 address: Yes** |
| SSH keys | **Generate a key pair for me** → **Save private key** (guarde bem esse arquivo `.key`) |
| Boot volume | padrão |

Clique em **Create**. Quando ficar verde (*Running*), anote o **Public IP address**.

**Erro "Out of capacity"**: é falta de máquina ARM livre na região naquele momento. Tente outro *Availability domain* na mesma tela, tente mais tarde, ou use 1 OCPU / 6 GB.

## 3. Liberar as portas 80 e 443

São **dois lugares** — os dois são obrigatórios.

**3a. Na rede da Oracle (Security List):**
Instances → `cuida` → na seção *Primary VNIC*, clique na **Subnet** → **Security Lists** → *Default Security List* → **Add Ingress Rules**:

| Source CIDR | IP Protocol | Destination Port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

(A porta 22/SSH já vem liberada. **Não** libere a 8080.)

**3b. No firewall da própria VM** — faça depois de conectar (passo 4).

## 4. Conectar na VM pelo PowerShell

```powershell
ssh -i C:\caminho\ssh-key-cuida.key ubuntu@IP_DA_VM
```

Se reclamar de *UNPROTECTED PRIVATE KEY FILE*, ajuste a permissão do arquivo uma vez:

```powershell
icacls C:\caminho\ssh-key-cuida.key /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

Já dentro da VM, libere as portas no firewall do Ubuntu da Oracle (ele bloqueia tudo que não é SSH):

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 5. Instalar o Docker na VM

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit
```

Conecte de novo (passo 4) e confira:

```bash
docker run --rm hello-world
docker compose version
```

## 6. Endereço grátis com DuckDNS

O HTTPS precisa de um nome, não só do IP.

1. Entre em [duckdns.org](https://www.duckdns.org) com Google ou GitHub.
2. Crie um subdomínio, ex.: `cuida-api` → vira `cuida-api.duckdns.org`.
3. No campo **current ip**, coloque o **IP público da VM** → **update ip**.
4. Confira no PowerShell: `nslookup cuida-api.duckdns.org` deve responder o IP da VM.

## 7. Baixar o projeto e configurar

Na VM:

```bash
git clone https://github.com/Mattos-Soph/cuida_web_back_end.git
cd cuida_web_back_end/Back-End/deploy
cp .env.example .env
openssl rand -hex 24    # copie: vai ser a EVOLUTION_API_KEY
openssl rand -hex 16    # copie: vai ser a EVOLUTION_DB_PASSWORD
nano .env
```

Preencha no `nano`:

| Variável | Valor |
|---|---|
| `DOMINIO` | `cuida-api.duckdns.org` (o seu) |
| `EVOLUTION_API_KEY` | o primeiro `openssl` |
| `EVOLUTION_DB_PASSWORD` | o segundo `openssl` |
| `SUPABASE_URL` / `SUPABASE_KEY` | do painel do Supabase (chave **service_role**) |
| `JWT_SECRET` | um texto longo aleatório (pode ser outro `openssl rand -hex 32`) |
| `NOTIFICACAO_API_KEY` | recomendado em produção (`openssl rand -hex 24`) — o app da gestão manda no header `x-api-key` |

Salvar no nano: **Ctrl+O**, Enter, **Ctrl+X**.

## 8. Subir tudo

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

Os 4 containers (`cuida_api`, `cuida_evolution`, `cuida_evolution_db`, `cuida_caddy`) devem ficar **Up**. O primeiro build leva alguns minutos.

Teste do seu PC, no navegador: **https://cuida-api.duckdns.org/api/health** → deve mostrar `{"status":"ok", ...}` com cadeado de HTTPS.

## 9. Conectar o WhatsApp (uma vez só)

A Evolution não fica aberta na internet. Para ler o QR, abra um **túnel SSH** do seu PC (deixe essa janela aberta enquanto usa):

```powershell
ssh -i C:\caminho\ssh-key-cuida.key -L 8080:localhost:8080 ubuntu@IP_DA_VM
```

1. No navegador do **seu PC**: **http://localhost:8080/manager**
2. Chave: o valor de `EVOLUTION_API_KEY`.
3. Crie a instância **`cuida`**, canal **Baileys**, e gere o QR.
4. No WhatsApp Business: ⋮ → **Dispositivos conectados** → **Conectar dispositivo**.

**Desligue a Evolution de casa** para o número não ficar conectado em dois servidores: no PC de casa, `docker compose -f docs/docker-compose.evolution.yml --profile v2 down`, e no celular remova o dispositivo antigo em *Dispositivos conectados*.

A sessão fica salva no Postgres da VM: reiniciar a VM ou os containers **não** exige ler o QR de novo.

## 10. Primeiro envio real pelo servidor

Na VM:

```bash
docker compose -f docker-compose.prod.yml exec api node scripts/testar-whatsapp.js "(14) 9XXXX-XXXX" --enviar
```

(troque pelo seu número pessoal). Se chegar, o servidor está pronto.

## 11. Apontar o front para o servidor

No `Front-End/.env` (e na hospedagem do front, se houver):

```
VITE_API_URL=https://cuida-api.duckdns.org/api
```

O back-end já aceita requisições de outros domínios (CORS aberto).

## 12. Atualizar depois de um merge no GitHub

```bash
cd ~/cuida_web_back_end && git pull
cd Back-End/deploy && docker compose -f docker-compose.prod.yml up -d --build
```

A fila de avisos é em memória: evite atualizar no meio de um disparo em massa.

---

## Comandos úteis (na VM, dentro de `Back-End/deploy`)

| Para | Comando |
|---|---|
| Ver os containers | `docker compose -f docker-compose.prod.yml ps` |
| Logs do back-end | `docker compose -f docker-compose.prod.yml logs -f api` |
| Logs da Evolution | `docker compose -f docker-compose.prod.yml logs -f evolution` |
| Logs do HTTPS | `docker compose -f docker-compose.prod.yml logs -f caddy` |
| Reiniciar só o back-end | `docker compose -f docker-compose.prod.yml restart api` |
| Parar tudo (mantém a sessão) | `docker compose -f docker-compose.prod.yml down` |
| Estado do WhatsApp | `curl -s localhost:8080/instance/connectionState/cuida -H "apikey: SUA_CHAVE"` |

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| "Out of capacity" ao criar a VM | sem máquina ARM livre | outro Availability domain, mais tarde, ou 1 OCPU/6 GB |
| `/api/health` não abre, sem cadeado | portas 80/443 fechadas ou DuckDNS com IP errado | refaça os passos 3a, 3b (iptables) e 6; veja `logs caddy` |
| Caddy: "challenge failed" | o domínio não aponta para a VM ou porta 80 fechada | `nslookup` do domínio; portas |
| 502 Bad Gateway | o back-end caiu | `logs api` (geralmente variável faltando no `.env`) |
| `ERRO_REDE` ao enviar | Evolution fora | `logs evolution`; `docker compose ... up -d` |
| `NAO_AUTORIZADO` | chave diferente | a api e a Evolution usam a mesma `EVOLUTION_API_KEY`; reinicie após trocar |
| `INSTANCIA_DESCONECTADA` | celular desvinculou | túnel SSH + manager + QR (passo 9) |

## Cuidados

- **VM recolhida por ociosidade:** a Oracle recolhe VMs *Always Free* quando, por 7 dias seguidos, CPU (percentil 95), rede **e** memória ficam abaixo de 20% ([documentação da Oracle](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)). Um back-end de faculdade fica ocioso quase o tempo todo, então o risco é real. A regra **não vale para contas Pay As You Go**: converter a conta (Billing → Upgrade) evita o problema e continua sem cobrança enquanto você ficar dentro dos limites grátis. Se não converter, entre na VM de vez em quando e confira se ela está *Running*.
- **Nunca** abra a porta 8080 na Security List: a Evolution controla o número de WhatsApp.
- O arquivo `deploy/.env` tem a chave `service_role` do Supabase: não copie para lugar nenhum e não faça commit.
- Guarde o arquivo `.key` do SSH: sem ele, não dá para entrar na VM.
