// eslint-disable-next-line no-undef
var Todos = artifacts.require('Todo');
module.exports = function(deployer) {
  // deployment steps
  deployer.deploy(Todos);
};