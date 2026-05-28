# Motor pentru executia de script-uri la distanta

Acest proiect este baza unei aplicatii client-server simple pentru materia Retele de Calculatoare. Scopul final este executia de pipeline-uri de scripturi Bash pe clienti diferiti, coordonate de un server central.

In etapele 1-2 sunt implementate:

- server TCP concurent
- clienti TCP simpli
- protocol JSON line based
- publicare scripturi disponibile
- publicare si stergere comenzi compuse
- listare stare server
- baza pentru executia de comenzi compuse (validare cerere)

In etapa 2, serverul accepta cereri de executie, valideaza comenzile si fisierele, dar nu executa inca scripturile pe tot pipeline-ul.

In etapa 3, serverul trimite primul script din pipeline catre clientul care il detine. Clientul ruleaza scriptul Bash local si intoarce outputul catre server. Propagarea prin restul pipeline-ului nu este inca implementata.



Serverul:

- asculta pe portul `8807`
- accepta mai multi clienti simultan
- atribuie id-uri simple de forma `client_1`, `client_2`
- tine evidenta clientilor conectati
- tine maparea `scriptName -> clientId`
- tine comenzile compuse `commandName -> pipeline`
- gestioneaza executiile active cu `executionId`

Clientul:

- se conecteaza la server prin TCP
- trimite un mesaj `HELLO`
- accepta comenzi simple din terminal
- afiseaza raspunsurile primite de la server
- ruleaza scripturi Bash local la cererea serverului (`EXECUTE_SCRIPT`)

## Structura proiectului

```text
server/
  server.js
  protocol.js
  package.json
  Dockerfile

client/
  client.js
  protocol.js
  package.json
  scripts/
    upper.sh
    prefix.sh

docker-compose.yml
README.md
```

## Protocol JSON line based

Fiecare mesaj este un obiect JSON pe o singura linie, terminat cu `\n`.

Exemplu:

```json
{"type":"HELLO","clientName":"clientA"}
```

### Mesaje client -> server

```json
{"type":"HELLO","clientName":"clientA"}
{"type":"PUBLISH_SCRIPTS","scripts":["upper","prefix"]}
{"type":"PUBLISH_COMMAND","commandName":"procesare","pipeline":["upper","prefix"]}
{"type":"DELETE_COMMAND","commandName":"procesare"}
{"type":"LIST_STATE"}
{"type":"EXECUTE_COMMAND_REQUEST","fileName":"date.txt","contentBase64":"..."}
{"type":"SCRIPT_OUTPUT","scriptName":"upper","outputContent":"VEVTVA==","executionId":"exec_123_client_1"}
```

### Mesaje server -> client

```json
{"type":"OK","message":"Scripturi publicate cu succes"}
{"type":"ERROR","message":"Scriptul upper este deja publicat de alt client"}
{"type":"EXECUTE_SCRIPT","scriptName":"upper","inputContent":"dGVzdA==","executionId":"exec_123_client_1"}
```

### Mesaje noi in etapa 3

**EXECUTE_SCRIPT** (server -> client):
- `scriptName` - numele scriptului de executat
- `inputContent` - continutul de intrare codificat in Base64
- `executionId` - identificator unic al executiei (format: `exec_<timestamp>_<clientId>`)

**SCRIPT_OUTPUT** (client -> server):
- `scriptName` - numele scriptului executat
- `outputContent` - rezultatul executiei codificat in Base64
- `executionId` - identificatorul executiei (primit din EXECUTE_SCRIPT)

In aceasta etapa, serverul trimite EXECUTE_SCRIPT doar catre clientul care detine **primul** script din pipeline. Outputul este logat pe server dar **nu este propagat** catre urmatorul script. Propagarea prin pipeline va fi implementata in etapa 4.

Exemple de raspunsuri:

```json
{"type":"OK","message":"Scripturi publicate cu succes"}
{"type":"ERROR","message":"Scriptul upper este deja publicat de alt client"}
```

La `LIST_STATE`, serverul raspunde cu:

- clientii conectati
- maparea scripturilor publicate
- comenzile compuse existente
- `missingScripts` pentru comenzile care refera scripturi disparute dupa deconectarea unui client

## Rulare server in Docker

Din radacina proiectului:

```bash
docker compose up --build
```

Serverul va porni pe portul `8807`.

## Rulare clienti local

Intr-un terminal separat:

```bash
cd client
npm install
node client.js clientA
```

Intr-un al doilea terminal:

```bash
cd client
npm install
node client.js clientB
```

Clientul se conecteaza implicit la `127.0.0.1:8807`.

## Comenzi disponibile in client

```text
publish-scripts upper,prefix
publish-command procesare upper,prefix
delete-command procesare
execute-file cale/catre/fisier
list-state
help
exit
```

Comanda `execute-file`:
- citeste continutul fisierului
- foloseste doar numele fisierului (fara cale) ca identificator de comanda
- encodeaza continutul in Base64
- trimite cererea catre server pentru validare si executie

## Comportament important in etapele 1-3

- Lista de scripturi a unui client poate fi publicata o singura data intr-o sesiune.
- Daca un alt client a publicat deja un script, serverul respinge cererea.
- O comanda compusa cu acelasi nume poate fi suprascrisa.
- Daca un client se deconecteaza, serverul elimina scripturile lui din mapare.
- Comenzile compuse nu sunt sterse automat la deconectare.
- Dupa deconectare, `list-state` poate arata comenzi cu `missingScripts`, adica pipeline-uri care nu mai pot fi executate complet in starea curenta.
- Serverul raspunde cu eroare controlata la JSON invalid si continua sa ruleze.
- Cererea `EXECUTE_COMMAND_REQUEST` este acceptata doar daca comanda exista si toate scripturile din pipeline sunt disponibile.
- In etapa 3, serverul trimite EXECUTE_SCRIPT doar pentru primul script din pipeline.
- Clientul ruleaza scriptul Bash local cu `child_process.execFile` si trimite outputul inapoi ca SCRIPT_OUTPUT.
- Daca scriptul Bash esueaza, clientul captureaza eroarea si o trimite in SCRIPT_OUTPUT (nu crape).
- Daca scriptul nu exista pe client sau inputul Base64 e nevalid, clientul raspunde cu ERROR.

## Ce este implementat in etapele 1-3

- comunicatie TCP simpla intre server si clienti
- mesaje JSON separate pe linii
- conectare si deconectare clienti
- publicare scripturi
- publicare si stergere comenzi compuse
- listare stare server
- validari de baza si mesaje clare de eroare
- containerizare Docker pentru server
- cererea `EXECUTE_COMMAND_REQUEST` cu validare de comanda, fisier si disponibilitate scripturi
- citirea fisierelor in client cu encoding Base64
- raportare controlata de erori la executie invalida
- executia primului script din pipeline pe clientul care il detine (etapa 3)
- mesaje noi: `EXECUTE_SCRIPT` si `SCRIPT_OUTPUT`
- gestionare `executionId` unic per executie
- clientul ruleaza scripturi Bash local cu `child_process.execFile`

## Testare manuala recomandata

### Testare etapa 3 (executie primul script din pipeline)

1. Porneste serverul:

   ```bash
   docker compose up --build
   ```

2. Porneste un client local:

   ```bash
   cd client
   node client.js clientA
   ```

3. In `clientA`, publica scripturi si comanda:

   ```text
   publish-scripts upper,prefix
   publish-command redimensionare upper,prefix
   ```

4. Creeaza un fisier local cu continut text:

   ```bash
   echo "hello world" > redimensionare
   ```

5. In `clientA`, executa comanda:

   ```text
   execute-file redimensionare
   ```

6. Verificari asteptate:

   - Serverul accepta cererea si trimite `EXECUTE_SCRIPT` cu `scriptName: "upper"` catre `clientA`
   - Clientul ruleaza `bash scripts/upper.sh` cu inputul `"hello world\n"`
   - Clientul trimite `SCRIPT_OUTPUT` cu outputul `"HELLO WORLD\n"` (codificat Base64)
   - Pe server apare in log: `Output de la upper: HELLO WORLD`
   - Doar primul script (`upper`) este executat; `prefix` nu este executat inca

7. Testeaza erori:

   - Incearca `execute-file comanda_inexistenta` -> eroare comanda nu exista
   - Sterge o comanda si incearca din nou -> eroare
   - Deconecteaza clientul si incearca din alt client -> eroare client deconectat

### Testare etapele 1-2 (validari existente)

4. In `clientB`, verifica erorile:

   ```text
   publish-scripts upper
   publish-scripts
   publish-command gol
   publish-command test lipsa
   delete-command necunoscuta
   ```

5. In `clientA`, incearca republicarea:

   ```text
   publish-scripts upper,prefix
   ```

6. In `clientA`, suprascrie si apoi sterge o comanda:

   ```text
   publish-command procesare prefix,upper
   delete-command procesare
   delete-command procesare
   ```

7. Publica din nou comanda `procesare`, apoi inchide `clientA` si ruleaza `list-state` din `clientB`.
   In raspuns trebuie sa apara `missingScripts` pentru scripturile disparute.

8. Pentru verificarea JSON invalid, foloseste un client TCP simplu sau `nc` si trimite o linie care nu este JSON valid.
   Serverul trebuie sa raspunda cu `ERROR` si sa ramana pornit.

9. Opreste serverul in timp ce un client este conectat.
   Clientul trebuie sa afiseze inchiderea conexiunii fara sa crape.

## TODO pentru etapele urmatoare

### Etapa 4 - Propagare prin pipeline
- dupa primirea SCRIPT_OUTPUT, serverul trimite outputul catre urmatorul script din pipeline
- serverul trimite EXECUTE_SCRIPT catre clientul care detine urmatorul script, cu outputContent ca inputContent
- procesul continua pana la sfarsitul pipeline-ului
- gestionare erori la fiecare pas din pipeline

### Etapa 5 - Raspuns final
- serverul colecteaza outputul final (dupa ultimul script din pipeline)
- serverul trimite `EXECUTE_RESPONSE` catre clientul solicitant cu rezultatul
- clientul afiseaza rezultatul final
