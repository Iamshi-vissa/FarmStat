// App-wide requests that any component can make without passing callbacks through every layer.
export const SEARCH = 'farmstat:search';   // open "Search all mandis"
export const PANEL = 'farmstat:panel';     // open the side panel with the state and mandi list

export const openSearch = () => window.dispatchEvent(new Event(SEARCH));
export const openSidePanel = () => window.dispatchEvent(new Event(PANEL));
