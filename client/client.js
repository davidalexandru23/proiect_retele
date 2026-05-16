const net = require("net");
const readline = require("readline");
const { decodeMessage, sendMessage } = require("./protocol");

const SERVER_HOST = process.env.SERVER_HOST || "127.0.0.1";
const SERVER_PORT = Number(process.env.SERVER_PORT || 5000);
const clientName = process.argv[2] || "client_local";

let inputBuffer = "";
let conexiuneActiva = false;

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

function afiseazaMesajServer(mesaj) {
  if (mesaj.type === "STATE") {
    console.log("STATE:");
    console.log(JSON.stringify(mesaj, null, 2));
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
