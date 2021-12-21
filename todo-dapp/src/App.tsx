import React from "react";
import "./App.css";
import List from "@mui/material/List";
import Web3 from 'web3';
import { Contract } from "web3-eth-contract";
import ListItemText from "@mui/material/ListItemText";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContentText,
  DialogTitle,
  ListItem,
  DialogContent,
} from "@mui/material";
import { MetaMaskInpageProvider } from "@metamask/providers";

// extra def to give types for the injected eth provider.
declare global {
  interface Window {
    ethereum: MetaMaskInpageProvider;
    web3?: Web3;
  }
}

interface Task {
  id: string;
  description: string;
  completed: boolean;
}

// demo hardcoded contract details relating to a local Ganache network (these will need to updated).
const ABI = require('./todoContractAbi.json');
const CONTRACT_ADDRESS = '0xC29fB00a8EddbB43EBa8AA38da9be7dA4b683042';
let ethAccounts: string[];
let ethContract: Contract | null = null;

// get the connected wallet accounts from the MetaMask provider.
const getAccounts = async (): Promise<string[]> => {
  if (window.ethereum) {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    window.web3 = new Web3(window.ethereum as any);
    return accounts ? accounts as string[] : [];
  }
  return [];
}

// fetch the contract details using the ABI schema & contract address.
const getContract = (): Contract | null => {
  if (ethContract) {
    return ethContract;
  }
  if (window.web3) {
    ethContract = new window.web3.eth.Contract(ABI, CONTRACT_ADDRESS);
    return ethContract;
  }
  return null;
}

// grab the tasks from the blockchain.
async function fetchTasks(): Promise<Task[]> {
  // check Eth is enabled & grab our wallet accounts.
  ethAccounts = await getAccounts();
  const contract = getContract();
  if (!ethAccounts.length || !contract) {
    console.error('eth provider not enabled!');
    return [];
  }
  // for this demo app only the first task from the contract (which is created on contract deployment).
  const { id, description, completed }: Task = await contract.methods.tasks(1).call();
  return [
    { id, description, completed }
  ];
}

// send a transaction (via MetaMask) to mark a task as complete.
async function sendTaskComplete(taskId: string): Promise<void> {
  const contract = getContract();
  if (!ethAccounts.length || !contract) {
    throw new Error('cant process task update');
  }
  // for demo just use first account in the list.
  const [accountAddress = ''] = ethAccounts;
  await contract.methods.markTaskComplete(taskId).send({ from: accountAddress });
}

function App() {
  // state items.
  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [alertOpen, setAlertOpen] = React.useState<boolean>(false);
  const [currentTask, setCurrentTask] = React.useState<Task | undefined>();

  // fetch and set the task list.
  const getTasks = async (): Promise<void> => {
    const tasks = await fetchTasks();
    setTasks(tasks);
  };
  // complete task action.
  const completeTask = async (task: Task) => {
    await sendTaskComplete(task.id);
    setTasks(
      tasks.map((taskItem) => {
        if (task.id === taskItem.id) {
          taskItem.completed = true;
        }
        return taskItem;
      })
    );
  };
  // hide show confirm modal.
  const onToggleAlert = () => {
    setAlertOpen(!alertOpen);
  };
  // show modal to confirm task complete.
  const onCompleteTask = (task: Task) => () => {
    setCurrentTask(task);
    onToggleAlert();
  };
  // on comfirming task complete from modal.
  const onMarkTaskComplete = () => {
    if (currentTask && !currentTask.completed) {
      completeTask(currentTask);
      setAlertOpen(false);
    }
  };

  // fetch the tasks after load.
  React.useEffect(() => {
    getTasks();
  }, []);

  return (
    <div className="App">
      <header className="App-header">
        <h1>Todo List:</h1>
        <List sx={{ width: "100%", maxWidth: 360 }}>
          {tasks.map((task) => {
            const { id, description, completed } = task;
            return (
              <ListItem key={id}>
                <ListItemText
                  sx={{ textDecoration: completed ? "line-through" : "none" }}
                >
                  {description}
                </ListItemText>
                <Button
                  variant="contained"
                  disabled={completed}
                  onClick={onCompleteTask(task)}
                >
                  Mark Complete
                </Button>
              </ListItem>
            );
          })}
        </List>
      </header>
      <div>
        <Dialog
          open={alertOpen}
          onClose={onToggleAlert}
          sx={{ bgcolor: "#333" }}
        >
          <DialogTitle>Confirm complete task.</DialogTitle>
          <DialogContent>
            <DialogContentText>
              Do you want to mark this task as completed?
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button variant="outlined" onClick={onToggleAlert}>
              Cancel.
            </Button>
            <Button variant="outlined" onClick={onMarkTaskComplete}>
              Mark Complete.
            </Button>
          </DialogActions>
        </Dialog>
      </div>
    </div>
  );
}

export default App;
