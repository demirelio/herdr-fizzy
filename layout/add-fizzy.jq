# jq --arg tabs <tab bar mod> -f add-fizzy.jq layouts/<name>.json
# Adds the Fizzy page to the right panel's `panel-body` stack, and points blocks showing the stock `tabs` mod at
# $tabs (pass "tabs" to leave the tab bar alone). Node ids are unique in a layout, so a `fizzy` id anywhere else stops it.
def page: { id: "fizzy", type: "block", content: { mod: "fizzy" } };
def stacks: .. | objects | select(.id == "panel-body" and .type == "stack");

if ([stacks] | length) != 1 then error("no single panel-body stack in this layout")
elif ([.. | objects | select(.id == "fizzy")] | length) > ([stacks | .children[]? | select(.id == "fizzy")] | length)
  then error("another node already has the id fizzy")
else
  (stacks |= (if any(.children[]?; .id == "fizzy") then . else .children += [page] end))
  | ((.. | objects | select(.content.mod? == "tabs") | .content.mod) |= $tabs)
end
