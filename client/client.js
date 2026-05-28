const net = require("net");
const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { decodeMessage, sendMessage } = require("./protocol");

const SERVER_HOST = process.env.SERVER_HOST || "127.0.0.1";
const SERVER_PORT = Number(process.env.SERVER_PORT || 5000);
const clientName = process.argv[2] || "client_local";

let inputBuffer = "";
let conexiuneActiva = false;
const scripturiLocale = new Set();
const SCRIPTS_DIR = path.join(__dirname, "scripts");

const clientSocket = net.createConnection(
  {
    host: SERVER_HOST,
    port: SERVER_PORT
  },
  () => {
    conexiuneActiva = true;
    console.log(`Conectat la server ca ${clientName}`);
    sendMessage(clientSocket, {
      type: "HELLO",
      clientName
    });
    afiseazaAjutor();
    terminal.prompt();
  }
);

clientSocket.setEncoding("utf8");

const terminal = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "> "
});

function parseLista(textLista) {
  if (!textLista) {
    return [];
  }

  return textLista
    .split(",")
    .map((valoare) => valoare.trim())
    .filter((valoare) => valoare.length > 0);
}

function afiseazaAjutor() {
  console.log("Comenzi disponibile:");
  console.log("  publish-scripts upper,prefix");
  console.log("  publish-command procesare upper,prefix");
  console.log("  delete-command procesare");
  console.log("  execute-file cale/catre/fisier");
  console.log("  list-state");
  console.log("  help");
  console.log("  exit");
}

function trimiteDinComanda(linieInput) {
  const [numeComanda, ...restArgumente] = linieInput.trim().split(/\s+/);

  if (!numeComanda) {
    return;
  }

  switch (numeComanda) {
    case "publish-scripts": {
      const listaScripturi = parseLista(restArgumente.join(" "));
      // Salvam local scripturile publicate pentru a le putea valida la EXECUTE_SCRIPT
      listaScripturi.forEach((s) => scripturiLocale.add(s));
      sendMessage(clientSocket, {
        type: "PUBLISH_SCRIPTS",
        scripts: listaScripturi
      });
      break;
    }
    case "publish-command": {
      const commandName = restArgumente[0] || "";
      const pipeline = parseLista(restArgumente.slice(1).join(" "));
      sendMessage(clientSocket, {
        type: "PUBLISH_COMMAND",
        commandName,
        pipeline
      });
      break;
    }
    case "delete-command": {
      const commandName = restArgumente[0] || "";
      sendMessage(clientSocket, {
        type: "DELETE_COMMAND",
        commandName
      });
      break;
    }
    case "execute-file": {
      const caleFisier = restArgumente[0] || "";
      if (!caleFisier) {
        console.log("Eroare: trebuie sa specifici calea fisierului");
        break;
      }

      try {
        const continutBytes = fs.readFileSync(caleFisier);
        const continutBase64 = continutBytes.toString("base64");
        const numeFisier = caleFisier.split("/").pop().split("\\").pop();

        sendMessage(clientSocket, {
          type: "EXECUTE_COMMAND_REQUEST",
          fileName: numeFisier,
          contentBase64: continutBase64
        });
      } catch (eroare) {
        console.log(`Eroare la citirea fisierului: ${eroare.message}`);
      }
      break;
    }
    case "list-state":
      sendMessage(clientSocket, {
        type: "LIST_STATE"
      });
      break;
    case "help":
      afiseazaAjutor();
      break;
    case "exit":
      conexiuneActiva = false;
      terminal.close();
      clientSocket.end();
      break;
    default:
      console.log(`Comanda necunoscuta: ${numeComanda}`);
  }
}

function gestioneazaExecuteScript(mesaj) {
  const { scriptName, inputContent, executionId } = mesaj;

  console.log(`\nEXECUTE_SCRIPT primit: script=${scriptName}, executionId=${executionId}`);

  // Valideaza ca scriptul exista in scripturile publicate
  if (!scripturiLocale.has(scriptName)) {
    console.log(`Eroare: scriptul ${scriptName} nu este publicat local`);
    sendMessage(clientSocket, {
      type: "ERROR",
      message: `Scriptul ${scriptName} nu este publicat pe acest client`
    });
    return;
  }

  // Decodifica inputContent din Base64
  let inputDecodat;
  try {
    inputDecodat = Buffer.from(inputContent, "base64").toString("utf8");
  } catch (eroare) {
    console.log(`Eroare: inputContent Base64 nevalid`);
    sendMessage(clientSocket, {
      type: "ERROR",
      message: `Input Base64 nevalid pentru scriptul ${scriptName}`
    });
    return;
  }

  // Calea catre scriptul Bash
  const caleFisierScript = path.join(SCRIPTS_DIR, `${scriptName}.sh`);

  // Verifica daca fisierul scriptului exista pe disc
  if (!fs.existsSync(caleFisierScript)) {
    console.log(`Eroare: fisierul ${caleFisierScript} nu exista pe disc`);
    sendMessage(clientSocket, {
      type: "ERROR",
      message: `Fisierul scriptului ${scriptName}.sh nu exista pe disc`
    });
    return;
  }

  // Ruleaza scriptul Bash cu inputul primit
  console.log(`Rulez: bash ${caleFisierScript}`);

  const procesScript = execFile("bash", [caleFisierScript], {
    timeout: 30000,
    maxBuffer: 1024 * 1024
  }, (eroare, stdout, stderr) => {
    if (eroare) {
      console.log(`Eroare la executia scriptului ${scriptName}: ${eroare.message}`);
      if (stderr) {
        console.log(`stderr: ${stderr}`);
      }
      // Capturam eroarea si trimitem outputul cu eroarea
      const eroareText = `Eroare executie ${scriptName}: ${eroare.message}\n${stderr || ""}`;
      const outputContent = Buffer.from(eroareText, "utf8").toString("base64");

      sendMessage(clientSocket, {
        type: "SCRIPT_OUTPUT",
        scriptName,
        outputContent,
        executionId
      });
      return;
    }

    console.log(`Scriptul ${scriptName} a terminat cu succes`);
    console.log(`Output: ${stdout}`);

    // Encodeaza outputul in Base64
    const outputContent = Buffer.from(stdout, "utf8").toString("base64");

    sendMessage(clientSocket, {
      type: "SCRIPT_OUTPUT",
      scriptName,
      outputContent,
      executionId
    });
  });

  // Trimite inputul pe stdin al procesului
  procesScript.stdin.write(inputDecodat);
  procesScript.stdin.end();
}

function afiseazaMesajServer(mesaj) {
  if (mesaj.type === "STATE") {
    console.log("STATE:");
    console.log(JSON.stringify(mesaj, null, 2));
    return;
  }

  // Gestioneaza cererea de executie script de la server
  if (mesaj.type === "EXECUTE_SCRIPT") {
    gestioneazaExecuteScript(mesaj);
    return;
  }

  if (mesaj.message) {
    console.log(`${mesaj.type}: ${mesaj.message}`);
    return;
  }

  console.log("Mesaj primit:");
  console.log(JSON.stringify(mesaj, null, 2));
}

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
      afiseazaMesajServer(mesaj);
    } catch (eroare) {
      console.log("Serverul a trimis un mesaj invalid");
    }
  }

  if (conexiuneActiva) {
    terminal.prompt();
  }
});

clientSocket.on("end", () => {
  conexiuneActiva = false;
  console.log("Serverul a inchis conexiunea");
  terminal.close();
});

clientSocket.on("close", () => {
  conexiuneActiva = false;
});

clientSocket.on("error", (eroare) => {
  conexiuneActiva = false;
  console.log(`Eroare conexiune: ${eroare.message}`);
  terminal.close();
});

terminal.on("line", (linieInput) => {
  if (!conexiuneActiva) {
    console.log("Nu exista conexiune activa la server");
    terminal.close();
    return;
  }

  trimiteDinComanda(linieInput);

  if (conexiuneActiva) {
    terminal.prompt();
  }
});

terminal.on("close", () => {
  if (!clientSocket.destroyed) {
    clientSocket.end();
  }
});

process.on("SIGINT", () => {
  terminal.close();
});
