/**
 * Reserved option key on a plugin add operation: the operation sets options but does not switch the plugin on, so a
 * plugin removed by an earlier operation stays removed. Config compatibility keys such as `foundation_runtime` use it.
 */
export const configureOnly = "$configureOnly"
