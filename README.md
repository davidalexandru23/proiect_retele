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
Executia reala si propagarea datelor prin pipeline vor fi implementate in etapele urmatoare.



Serverul:

- asculta pe portul `5000`
- accepta mai multi clienti simultan
- atribuie id-uri simple de forma `client_1`, `client_2`
- tine evidenta clientilor conectati
- tine maparea `scriptName -> clientId`
- tine comenzile compuse `commandName -> pipeline`

Clientul:

- se conecteaza la server prin TCP
- trimite un mesaj `HELLO`
- accepta comenzi simple din terminal
- afiseaza raspunsurile primite de la server

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

Mesaje acceptate:

```json
{"type":"HELLO","clientName":"clientA"}
{"type":"PUBLISH_SCRIPTS","scripts":["upper","prefix"]}
{"type":"PUBLISH_COMMAND","commandName":"procesare","pipeline":["upper","prefix"]}
{"type":"DELETE_COMMAND","commandName":"procesare"}
{"type":"LIST_STATE"}
{"type":"EXECUTE_COMMAND_REQUEST","fileName":"date.txt","contentBase64":"..."}
```

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

Serverul va porni pe portul `5000`.

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

Clientul se conecteaza implicit la `127.0.0.1:5000`.

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

## Comportament important in etapele 1-2

- Lista de scripturi a unui client poate fi publicata o singura data intr-o sesiune.
- Daca un alt client a publicat deja un script, serverul respinge cererea.
- O comanda compusa cu acelasi nume poate fi suprascrisa.
- Daca un client se deconecteaza, serverul elimina scripturile lui din mapare.
- Comenzile compuse nu sunt sterse automat la deconectare.
- Dupa deconectare, `list-state` poate arata comenzi cu `missingScripts`, adica pipeline-uri care nu mai pot fi executate complet in starea curenta.
- Serverul raspunde cu eroare controlata la JSON invalid si continua sa ruleze.
- Cererea `EXECUTE_COMMAND_REQUEST` este acceptata doar daca comanda exista si toate scripturile din pipeline sunt disponibile.
- In etapa 2, serverul doar valideaza cererea, nu executa inca scripturile.

## Ce este implementat in etapele 1-2

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

## Testare manuala recomandata

### Testare etapele 1-2 (validare cerere executie)

1. Porneste serverul:

   ```bash
   docker compose up --build
   ```

2. Porneste doi clienti locali:

   ```bash
   cd client
   node client.js clientA
   ```

   ```bash
   cd client
   node client.js clientB
   ```

3. In `clientA`, publica scripturi si comanda:

   ```text
   publish-scripts upper,prefix
   publish-command procesare upper,prefix
   list-state
   ```

4. Creeaza un fisier local pentru test:

   ```bash
   echo "test content" > procesare
   ```

5. In `clientA`, incearca sa executi comanda:

   ```text
   execute-file procesare
   ```

   Serverul trebuie sa raspunda: `"OK": "Cererea de executie pentru comanda procesare a fost acceptata"`

6. Testeaza erori de validare:
   - `execute-file necunoscuta` trebuie sa raspunda cu eroare de comanda inexistenta
   - `execute-file` fara argument trebuie sa afiseze eroare local
   - Sterge o comanda cu `delete-command procesare` si apoi `execute-file procesare` trebuie sa raspunda cu eroare

### Testare etapele 1 (validari existente)

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

### Etapa 3 - Executie pe primul script
- serverul trimite `EXECUTE_SCRIPT` catre clientul care detine primul script din pipeline
- mesajul contine: scriptName, inputContent (Base64)
- clientul ruleaza scriptul Bash local cu inputul

### Etapa 4 - Propagare prin pipeline
- clientul intoarce `SCRIPT_OUTPUT` cu outputul executiei
- serverul trimite outputul catre urmatorul script din pipeline
- procesul continua pana la sfarsitul pipeline-ului

### Etapa 5 - Raspuns final
- serverul colecteaza outputul final
- serverul trimite `EXECUTE_RESPONSE` catre clientul solicitant cu rezultatul
- clientul afiseaza rezultatul final
