const net = require("net");
const { decodeMessage, sendMessage } = require("./protocol");

const PORT = Number(process.env.PORT || 5000);

let urmatorClientId = 1;
const clientiConectati = new Map();
const scripturiByName = new Map();
const comenziByName = new Map();
const executiiActive = new Map();

function esteTextValid(valoare) {
  return typeof valoare === "string" && valoare.trim().length > 0;
}

function trimLista(listaValori) {
  if (!Array.isArray(listaValori)) {
    return [];
  }

  return listaValori
    .filter((valoare) => typeof valoare === "string")
    .map((valoare) => valoare.trim())
    .filter((valoare) => valoare.length > 0);
}

function raspundeEroare(clientSocket, mesaj) {
  sendMessage(clientSocket, {
    type: "ERROR",
    message: mesaj
  });
}

function gestioneazaHello(clientSocket, clientInfo, mesaj) {
  const clientName = esteTextValid(mesaj.clientName) ? mesaj.clientName.trim() : "fara_nume";
  clientInfo.clientName = clientName;

  sendMessage(clientSocket, {
    type: "OK",
    message: `Salut ${clientName}, esti conectat ca ${clientInfo.clientId}`,
    clientId: clientInfo.clientId
  });
}

function gestioneazaPublishScripts(clientSocket, clientInfo, mesaj) {
  if (clientInfo.aPublicatScripturi) {
    raspundeEroare(clientSocket, "Lista de scripturi nu mai poate fi modificata in aceasta sesiune");
    return;
  }

  const listaScripturi = trimLista(mesaj.scripts);

  if (listaScripturi.length === 0) {
    raspundeEroare(clientSocket, "Lista de scripturi nu poate fi goala");
    return;
  }

  const scripturiUnice = [...new Set(listaScripturi)];

  for (const numeScript of scripturiUnice) {
    const proprietarCurent = scripturiByName.get(numeScript);

    if (proprietarCurent && proprietarCurent !== clientInfo.clientId) {
      raspundeEroare(clientSocket, `Scriptul ${numeScript} este deja publicat de alt client`);
      return;
    }
  }

  for (const numeScript of scripturiUnice) {
    scripturiByName.set(numeScript, clientInfo.clientId);
    clientInfo.scripturiPublicate.add(numeScript);
  }

  clientInfo.aPublicatScripturi = true;

  sendMessage(clientSocket, {
    type: "OK",
    message: "Scripturi publicate cu succes"
  });
}

function gestioneazaPublishCommand(clientSocket, mesaj) {
  const commandName = esteTextValid(mesaj.commandName) ? mesaj.commandName.trim() : "";
  const pipeline = trimLista(mesaj.pipeline);

  if (!commandName) {
    raspundeEroare(clientSocket, "Numele comenzii nu poate fi gol");
    return;
  }

  if (pipeline.length === 0) {
    raspundeEroare(clientSocket, "Pipeline-ul nu poate fi gol");
    return;
  }

  for (const numeScript of pipeline) {
    if (!scripturiByName.has(numeScript)) {
      raspundeEroare(clientSocket, `Scriptul ${numeScript} nu exista`);
      return;
    }
  }

  comenziByName.set(commandName, [...pipeline]);

  sendMessage(clientSocket, {
    type: "OK",
    message: `Comanda ${commandName} a fost publicata`
  });
}

function gestioneazaDeleteCommand(clientSocket, mesaj) {
  const commandName = esteTextValid(mesaj.commandName) ? mesaj.commandName.trim() : "";

  if (!commandName) {
    raspundeEroare(clientSocket, "Numele comenzii nu poate fi gol");
    return;
  }

  if (!comenziByName.has(commandName)) {
    raspundeEroare(clientSocket, `Comanda ${commandName} nu exista`);
    return;
  }

  comenziByName.delete(commandName);

  sendMessage(clientSocket, {
    type: "OK",
    message: `Comanda ${commandName} a fost stearsa`
  });
}

function construiesteState() {
  const clients = [...clientiConectati.values()].map((clientInfo) => ({
    clientId: clientInfo.clientId,
    clientName: clientInfo.clientName,
    scripts: [...clientInfo.scripturiPublicate]
  }));

  const scriptsByName = Object.fromEntries(scripturiByName.entries());
  const commandsByName = {};

  for (const [commandName, pipeline] of comenziByName.entries()) {
    commandsByName[commandName] = {
      pipeline: [...pipeline],
      missingScripts: pipeline.filter((numeScript) => !scripturiByName.has(numeScript))
    };
  }

  return {
    type: "STATE",
    clients,
    scriptsByName,
    commandsByName
  };
}

function gestioneazaExecuteCommand(clientSocket, clientInfo, mesaj) {
  const numeFisier = esteTextValid(mesaj.fileName) ? mesaj.fileName.trim() : "";
  const continutBase64 = mesaj.contentBase64;

  if (!numeFisier) {
    raspundeEroare(clientSocket, "Fisierul nu poate fi gol");
    return;
  }

  if (typeof continutBase64 !== "string" || continutBase64.trim().length === 0) {
    raspundeEroare(clientSocket, "Continut Base64 invalid");
    return;
  }

  // Extrage numele comenzii din nume fisier (fara path)
  const numeComanda = numeFisier.split("/").pop().split("\\").pop();

  if (!comenziByName.has(numeComanda)) {
    raspundeEroare(clientSocket, `Comanda ${numeComanda} nu exista`);
    return;
  }

  const pipeline = comenziByName.get(numeComanda);

  // Verifica daca toate scripturile din pipeline sunt disponibile
  const scripturiLipsa = pipeline.filter((numeScript) => !scripturiByName.has(numeScript));

  if (scripturiLipsa.length > 0) {
    raspundeEroare(
      clientSocket,
      `Comenziul nu poate fi executata. Scripturi lipsa: ${scripturiLipsa.join(", ")}`
    );
    return;
  }

  // Incearca decodarea Base64 pentru a valida formatul
  try {
    Buffer.from(continutBase64, "base64").toString();
  } catch (eroare) {
    raspundeEroare(clientSocket, "Continut Base64 nevalid");
    return;
  }

  // Genereaza un executionId unic
  const executionId = `exec_${Date.now()}_${clientInfo.clientId}`;

  // Identifica clientul care detine primul script din pipeline
  const primulScript = pipeline[0];
  const proprietarId = scripturiByName.get(primulScript);
  const proprietarInfo = clientiConectati.get(proprietarId);

  if (!proprietarInfo) {
    raspundeEroare(clientSocket, `Clientul care detine scriptul ${primulScript} nu mai este conectat`);
    return;
  }

  // Salveaza starea executiei
  executiiActive.set(executionId, {
    executionId,
    pipeline: [...pipeline],
    pasulCurent: 0,
    inputContent: continutBase64,
    clientSolicitant: clientInfo.clientId,
    socketSolicitant: clientSocket
  });

  console.log(`[${executionId}] Executie pornita pentru comanda ${numeComanda}, pipeline: ${pipeline.join(" -> ")}`);
  console.log(`[${executionId}] Trimite EXECUTE_SCRIPT ${primulScript} catre ${proprietarId}`);

  // Trimite EXECUTE_SCRIPT catre clientul care detine primul script
  sendMessage(proprietarInfo.clientSocket, {
    type: "EXECUTE_SCRIPT",
    scriptName: primulScript,
    inputContent: continutBase64,
    executionId
  });

  sendMessage(clientSocket, {
    type: "OK",
    message: `Cererea de executie pentru comanda ${numeComanda} a fost acceptata (executionId: ${executionId})`
  });
}

function gestioneazaScriptOutput(clientSocket, clientInfo, mesaj) {
  const { scriptName, outputContent, executionId } = mesaj;

  if (!esteTextValid(executionId)) {
    raspundeEroare(clientSocket, "executionId lipsa sau invalid");
    return;
  }

  if (!esteTextValid(scriptName)) {
    raspundeEroare(clientSocket, "scriptName lipsa sau invalid");
    return;
  }

  if (typeof outputContent !== "string") {
    raspundeEroare(clientSocket, "outputContent lipsa sau invalid");
    return;
  }

  const executie = executiiActive.get(executionId);

  if (!executie) {
    raspundeEroare(clientSocket, `Executia ${executionId} nu exista sau a expirat`);
    return;
  }

  const scriptAsteptat = executie.pipeline[executie.pasulCurent];

  if (scriptName !== scriptAsteptat) {
    raspundeEroare(clientSocket, `Script neasteptat: ${scriptName}, se astepta: ${scriptAsteptat}`);
    return;
  }

  console.log(`[${executionId}] SCRIPT_OUTPUT primit pentru ${scriptName}`);

  // TODO etapa 4: Propaga outputul catre urmatorul script din pipeline
  // TODO etapa 4: Daca mai sunt scripturi in pipeline, trimite EXECUTE_SCRIPT catre urmatorul client
  // TODO etapa 5: Daca pipeline-ul s-a terminat, trimite EXECUTE_RESPONSE catre clientul solicitant

  // Deocamdata, logam outputul si curatam executia
  try {
    const outputDecodat = Buffer.from(outputContent, "base64").toString("utf8");
    console.log(`[${executionId}] Output de la ${scriptName}: ${outputDecodat}`);
  } catch (eroare) {
    console.log(`[${executionId}] Output Base64 invalid de la ${scriptName}`);
  }

  executiiActive.delete(executionId);
  console.log(`[${executionId}] Executie finalizata (doar primul script, pipeline incomplet)`);
}

function gestioneazaMesaj(clientSocket, clientInfo, mesaj) {
  if (!mesaj || typeof mesaj !== "object" || typeof mesaj.type !== "string") {
    raspundeEroare(clientSocket, "Mesaj invalid");
    return;
  }

  switch (mesaj.type) {
    case "HELLO":
      gestioneazaHello(clientSocket, clientInfo, mesaj);
      break;
    case "PUBLISH_SCRIPTS":
      gestioneazaPublishScripts(clientSocket, clientInfo, mesaj);
      break;
    case "PUBLISH_COMMAND":
      gestioneazaPublishCommand(clientSocket, mesaj);
      break;
    case "DELETE_COMMAND":
      gestioneazaDeleteCommand(clientSocket, mesaj);
      break;
    case "LIST_STATE":
      sendMessage(clientSocket, construiesteState());
      break;
    case "EXECUTE_COMMAND_REQUEST":
      gestioneazaExecuteCommand(clientSocket, clientInfo, mesaj);
      break;
    case "SCRIPT_OUTPUT":
      gestioneazaScriptOutput(clientSocket, clientInfo, mesaj);
      break;
    default:
      raspundeEroare(clientSocket, `Tip de mesaj necunoscut: ${mesaj.type}`);
  }
}

function eliminaClient(clientInfo) {
  clientiConectati.delete(clientInfo.clientId);

  for (const numeScript of clientInfo.scripturiPublicate) {
    if (scripturiByName.get(numeScript) === clientInfo.clientId) {
      scripturiByName.delete(numeScript);
    }
  }
}

const serverTcp = net.createServer((clientSocket) => {
  const clientId = `client_${urmatorClientId++}`;
  const clientInfo = {
    clientId,
    clientName: "necunoscut",
    clientSocket,
    scripturiPublicate: new Set(),
    aPublicatScripturi: false
  };

  clientiConectati.set(clientId, clientInfo);
  console.log(`Client conectat: ${clientId}`);

  let inputBuffer = "";
  let conexiuneInchisa = false;

  clientSocket.setEncoding("utf8");

  clientSocket.on("data", (inputBytes) => {
    inputBuffer += inputBytes;
    const liniiMesaj = inputBuffer.split("\n");
    inputBuffer = liniiMesaj.pop();

    for (const linieMesaj of liniiMesaj) {
      if (!linieMesaj.trim()) {
        continue;
      }

      try {
        const mesaj = decodeMessage(linieMesaj);
        gestioneazaMesaj(clientSocket, clientInfo, mesaj);
      } catch (eroare) {
        raspundeEroare(clientSocket, "JSON invalid");
      }
    }
  });

  clientSocket.on("end", () => {
    if (!conexiuneInchisa) {
      conexiuneInchisa = true;
      eliminaClient(clientInfo);
      console.log(`Client deconectat: ${clientId}`);
    }
  });

  clientSocket.on("close", () => {
    if (!conexiuneInchisa) {
      conexiuneInchisa = true;
      eliminaClient(clientInfo);
      console.log(`Client deconectat: ${clientId}`);
    }
  });

  clientSocket.on("error", (eroare) => {
    console.log(`Eroare client ${clientId}: ${eroare.message}`);
  });
});

serverTcp.on("error", (eroare) => {
  console.error(`Eroare server: ${eroare.message}`);
});

serverTcp.listen(PORT, () => {
  console.log(`Serverul TCP asculta pe portul ${PORT}`);
});

function inchideServer() {
  console.log("Serverul se inchide...");

  for (const clientInfo of clientiConectati.values()) {
    clientInfo.clientSocket.end();
  }

  serverTcp.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", inchideServer);
process.on("SIGTERM", inchideServer);
