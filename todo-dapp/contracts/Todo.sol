pragma solidity >=0.7.0 <0.9.0;

contract Todo {
  // Total tasks in the list & next task id.
  uint public taskCount = 0;

// Defining structure of a task object. 
  struct Task {
    uint id;
    string description;
    bool completed;
  }

 // create a map of tasks.
  mapping(uint => Task) public tasks;

// event definitions for actions on the todo list 
  event TaskCreated(
    uint id,
    string description,
    bool completed
  );

  event TaskMarkCompleted(
    uint id,
    bool completed
  );

  constructor() {
    // create a new task on contract deployment.
    createTask("Task to be completed.");
  }

    // Creates a new task with a given description.
    function createTask(string memory _description) public {
        taskCount++;
        tasks[taskCount] = Task(taskCount, _description, false);
        // fire an event.
        emit TaskCreated(taskCount, _description, false);
    }



    // Marks a task as completed 
    function markTaskComplete(uint _id) public {
        Task memory _task = tasks[_id];
        _task.completed = !_task.completed;
        tasks[_id] = _task;
        
        emit TaskMarkCompleted(_id, _task.completed);
    }
}