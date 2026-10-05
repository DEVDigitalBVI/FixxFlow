import assert from 'node:assert/strict';
import test from 'node:test';
import { componentHarness } from '../../../tests/helpers/component-harness.mjs';

test('category picker clears a dependent selection and scopes each subcategory request to its parent',()=>{
 const ui=componentHarness('src/features/tickets/category-fields.tsx','CategoryFields',{categoryId:'old',subcategoryId:'child'});
 try {
  assert.equal(ui.find(n=>n.props.resource==='subcategories').props.parentId,'old');
  ui.find(n=>n.props.resource==='categories').props.onChange('new');ui.render();
  assert.equal(ui.find(n=>n.props.resource==='subcategories').props.parentId,'new');
  assert.equal(ui.find(n=>n.props.resource==='subcategories').props.value,'');
  ui.find(n=>n.props.resource==='categories').props.onChange('');ui.render();
  assert.equal(ui.all(n=>n.props.resource==='subcategories').length,0);
  assert.equal(ui.find(n=>n.props.name==='subcategoryId').props.value,'');
 } finally {ui.close();}
});
test('employee category field stays optional and does not expose subcategories',()=>{
 const ui=componentHarness('src/features/tickets/category-fields.tsx','CategoryFields',{categoryId:'old',simple:true});
 try {assert.equal(ui.all(n=>n.props.resource==='subcategories').length,0);assert.match(ui.find(n=>n.props.resource==='categories').props.label,/optional/);}
 finally {ui.close();}
});
