// Verbos animados de "trabalhando" estilo Claude Code / kapi-code. Trocam a cada
// poucos segundos no spinner. PT com sabor hacker/dev do João, EN clássico.
import type { Lang } from './i18n.js'

const PT = [
  // hacker/pentest
  'Hackeando', 'Invadindo', 'Quebrando criptografia', 'Caçando bugs', 'Engenharia reversa',
  'Bypassando firewall', 'Explorando vulnerabilidade', 'Injetando payload', 'Sniffando pacotes',
  'Escalando privilégios', 'Decompilando binário', 'Fuzzing brabo', 'Pivotando rede',
  'Exfiltrando dados', 'Crackeando hash', 'Forjando token', 'Spoofando DNS', 'Tunelando tráfego',
  'Compilando exploit', 'Hookando processo', 'Dumpando memória', 'Bruteforçando',
  'Interceptando request', 'Enumerando alvos', 'Mapeando superfície', 'Quebrando sandbox',
  // dev
  'Codando feito louco', 'Refatorando tudo', 'Buildando deploy', 'Subindo container',
  'Transpilando TypeScript', 'Otimizando queries', 'Resolvendo merge conflict', 'Commitando feat',
  'Parseando JSON', 'Lintando código', 'Testando endpoint', 'Spawning agentes',
  'Polindo código', 'Shipando feature', 'Aquecendo cache',
  // sabor brasileiro (kapi)
  'Bolando', 'Tramando', 'Cozinhando', 'Matutando', 'Desenrolando', 'Gambiarrando',
  'Capivareando', 'Sambando', 'Tropicalizando', 'Pilotando', 'Desvendando', 'Decifrando',
  'Maquinando', 'Engenheirando', 'Ruminando', 'Filosofando', 'Cogitando', 'Conjurando',
  'Invocando', 'Forjando', 'Lapidando', 'Destilando',
]

const EN = [
  'Hacking', 'Cracking crypto', 'Hunting bugs', 'Reverse-engineering', 'Bypassing firewall',
  'Exploiting', 'Injecting payload', 'Sniffing packets', 'Escalating privileges', 'Fuzzing hard',
  'Pivoting network', 'Exfiltrating data', 'Forging token', 'Spoofing DNS', 'Tunneling traffic',
  'Compiling exploit', 'Dumping memory', 'Bruteforcing', 'Enumerating targets', 'Mapping surface',
  'Coding like crazy', 'Refactoring', 'Building deploy', 'Spinning container', 'Optimizing queries',
  'Committing feat', 'Parsing JSON', 'Linting', 'Testing endpoint', 'Spawning agents',
  'Polishing code', 'Shipping feature', 'Warming cache', 'Pondering', 'Cooking', 'Brewing',
]

// índice rotativo determinístico (sem Math.random pra não rerenderizar caótico)
let counter = 0
export const nextVerb = (lang: Lang): string => {
  const list = lang === 'en' ? EN : PT
  const v = list[counter % list.length]!
  counter += 7 // passo primo pra variar bem
  return v
}
