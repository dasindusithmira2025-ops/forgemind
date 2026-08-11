//! Repository-native change generation.
//!
//! A Prisma repository gets a Prisma schema and a Prisma-style migration. A raw-SQL repository gets
//! a SQL migration in the style it already uses. Paralith never dumps arbitrary SQL into an
//! ORM-managed project, and it never invents a technology the repository does not already use.

use std::collections::HashMap;

use crate::models::{
    DatabaseChange, DatabaseChangeKind, DatabaseColumn, DatabaseEngine, DatabaseObject,
    ExtractedDatabaseGraph, ForeignKey, Index, PrimaryKey, ReferentialAction, UniqueConstraint,
};

/// Regenerate a Prisma schema for the target graph, preserving the repository's existing
/// `datasource`/`generator` blocks verbatim so provider, URL, and generator settings are untouched.
pub fn generate_prisma_schema(current_schema: &str, target: &ExtractedDatabaseGraph) -> String {
    let mut output = String::new();
    for block in preserved_prisma_blocks(current_schema) {
        output.push_str(&block);
        output.push_str("\n\n");
    }

    let mut enums: Vec<&crate::models::Enum> = target
        .objects
        .iter()
        .filter_map(|object| match object {
            DatabaseObject::Enum(value) => Some(value),
            _ => None,
        })
        .collect();
    enums.sort_by(|left, right| left.name.cmp(&right.name));
    for value in enums {
        output.push_str(&format!("enum {} {{\n", value.name));
        for member in &value.values {
            output.push_str(&format!("  {}\n", member.name));
        }
        output.push_str("}\n\n");
    }

    let index = GraphIndex::new(target);
    let mut tables: Vec<&crate::models::DatabaseTable> = index.tables.values().copied().collect();
    tables.sort_by(|left, right| left.name.cmp(&right.name));

    for table in tables {
        // Prisma models are addressed by symbol; the ORM symbol is preserved when the schema already
        // had one so relation fields keep pointing at the same model name.
        let model_name = index
            .orm_symbol(&table.meta.identity.id)
            .unwrap_or_else(|| pascal_case(&table.name));
        output.push_str(&format!("model {model_name} {{\n"));

        let columns = index.columns_of(&table.meta.identity.id);
        let single_pk = index
            .primary_key(table)
            .filter(|key| key.column_ids.len() == 1)
            .map(|key| key.column_ids[0].clone());
        let single_unique: Vec<String> = index
            .unique_constraints(table)
            .into_iter()
            .filter(|constraint| constraint.column_ids.len() == 1)
            .map(|constraint| constraint.column_ids[0].clone())
            .collect();

        for column in &columns {
            let mut line = format!(
                "  {} {}{}",
                column
                    .mapped_name
                    .clone()
                    .unwrap_or_else(|| column.name.clone()),
                column.native_type,
                if column.nullable { "?" } else { "" }
            );
            if single_pk.as_deref() == Some(column.meta.identity.id.as_str()) {
                line.push_str(" @id");
            }
            if single_unique.contains(&column.meta.identity.id) {
                line.push_str(" @unique");
            }
            if let Some(default) = &column.default {
                line.push_str(&format!(" @default({})", default.normalized));
            }
            if column.mapped_name.is_some() {
                line.push_str(&format!(" @map(\"{}\")", column.name));
            }
            output.push_str(&line);
            output.push('\n');
        }

        for key in index.foreign_keys(table) {
            let target_model = index
                .orm_symbol(&key.referenced_table_id)
                .or_else(|| {
                    index
                        .tables
                        .get(key.referenced_table_id.as_str())
                        .map(|table| pascal_case(&table.name))
                })
                .unwrap_or_else(|| "Unknown".to_owned());
            let fields = index.column_names(&key.column_ids);
            let references = index.column_names(&key.referenced_column_ids);
            if fields.is_empty() || references.is_empty() {
                continue;
            }
            let mut relation = format!(
                "  {} {target_model} @relation(fields: [{}], references: [{}]",
                camel_case(&target_model),
                fields.join(", "),
                references.join(", ")
            );
            if key.on_delete != ReferentialAction::NoAction {
                relation.push_str(&format!(", onDelete: {}", prisma_action(&key.on_delete)));
            }
            if key.on_update != ReferentialAction::NoAction {
                relation.push_str(&format!(", onUpdate: {}", prisma_action(&key.on_update)));
            }
            relation.push_str(")\n");
            output.push_str(&relation);
        }

        if let Some(key) = index.primary_key(table) {
            if key.column_ids.len() > 1 {
                output.push_str(&format!(
                    "  @@id([{}])\n",
                    index.column_names(&key.column_ids).join(", ")
                ));
            }
        }
        for constraint in index.unique_constraints(table) {
            if constraint.column_ids.len() > 1 {
                output.push_str(&format!(
                    "  @@unique([{}])\n",
                    index.column_names(&constraint.column_ids).join(", ")
                ));
            }
        }
        for declared in index.indexes(table) {
            let columns = index.column_names(
                &declared
                    .keys
                    .iter()
                    .filter_map(|key| key.column_id.clone())
                    .collect::<Vec<_>>(),
            );
            if columns.is_empty() {
                continue;
            }
            output.push_str(&format!(
                "  @@index([{}], name: \"{}\")\n",
                columns.join(", "),
                declared.name
            ));
        }
        if table.mapped_name.is_some() || model_name != table.name {
            output.push_str(&format!("  @@map(\"{}\")\n", qualified_or_name(table)));
        }
        output.push_str("}\n\n");
    }
    output.trim_end().to_owned() + "\n"
}

/// Keep everything that is not a `model` or `enum` block: datasource, generator, comments.
fn preserved_prisma_blocks(schema: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut current = String::new();
    let mut depth = 0usize;
    let mut keep = false;
    for line in schema.lines() {
        let trimmed = line.trim_start();
        if depth == 0 {
            if trimmed.starts_with("model ") || trimmed.starts_with("enum ") {
                keep = false;
            } else if trimmed.starts_with("datasource ") || trimmed.starts_with("generator ") {
                keep = true;
                current.clear();
            } else if !trimmed.starts_with('}') && !trimmed.is_empty() && !keep {
                continue;
            }
        }
        if keep {
            current.push_str(line);
            current.push('\n');
        }
        depth += line.matches('{').count();
        depth = depth.saturating_sub(line.matches('}').count());
        if depth == 0 && keep && line.contains('}') {
            blocks.push(current.trim_end().to_owned());
            current.clear();
            keep = false;
        }
    }
    blocks
}

/// Generate a SQL migration for a semantic delta.
///
/// Only the statements the delta actually requires are emitted, in dependency order: new tables
/// before the foreign keys that reference them, drops last.
pub fn generate_sql_migration(
    engine: &DatabaseEngine,
    changes: &[DatabaseChange],
    before: &ExtractedDatabaseGraph,
    after: &ExtractedDatabaseGraph,
) -> String {
    let after_index = GraphIndex::new(after);
    let before_index = GraphIndex::new(before);
    let mut statements: Vec<String> = Vec::new();
    let changed: Vec<&str> = changes
        .iter()
        .filter_map(|change| change.object_id.as_deref())
        .collect();

    for object in &after.objects {
        if !changed.contains(&object.meta().identity.id.as_str()) {
            continue;
        }
        match object {
            DatabaseObject::Table(table) => {
                if before_index
                    .table_by_qualified(&table.meta.identity.qualified_name)
                    .is_some()
                {
                    continue;
                }
                statements.push(create_table_statement(engine, table, &after_index));
            }
            DatabaseObject::Column(column) => {
                let Some(table) = after_index.tables.get(column.table_id.as_str()) else {
                    continue;
                };
                if before_index
                    .table_by_qualified(&table.meta.identity.qualified_name)
                    .is_none()
                {
                    continue;
                }
                statements.push(format!(
                    "ALTER TABLE {} ADD COLUMN {};",
                    quote_identifier(engine, &table.name),
                    column_definition(engine, column)
                ));
            }
            DatabaseObject::Index(declared) => {
                let Some(table) = after_index.tables.get(declared.table_id.as_str()) else {
                    continue;
                };
                let columns = after_index.column_names(
                    &declared
                        .keys
                        .iter()
                        .filter_map(|key| key.column_id.clone())
                        .collect::<Vec<_>>(),
                );
                if columns.is_empty() {
                    continue;
                }
                statements.push(format!(
                    "CREATE {}INDEX {} ON {} ({});",
                    if declared.unique { "UNIQUE " } else { "" },
                    quote_identifier(engine, &declared.name),
                    quote_identifier(engine, &table.name),
                    columns
                        .iter()
                        .map(|column| quote_identifier(engine, column))
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
            }
            _ => {}
        }
    }

    for object in &after.objects {
        if !changed.contains(&object.meta().identity.id.as_str()) {
            continue;
        }
        if let DatabaseObject::ForeignKey(key) = object {
            let (Some(table), Some(referenced)) = (
                after_index.tables.get(key.table_id.as_str()),
                after_index.tables.get(key.referenced_table_id.as_str()),
            ) else {
                continue;
            };
            let columns = after_index.column_names(&key.column_ids);
            let references = after_index.column_names(&key.referenced_column_ids);
            if columns.is_empty() || references.is_empty() {
                continue;
            }
            statements.push(format!(
                "ALTER TABLE {} ADD CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({}) ON DELETE {} ON UPDATE {};",
                quote_identifier(engine, &table.name),
                quote_identifier(
                    engine,
                    &key.name.clone().unwrap_or_else(|| format!(
                        "fk_{}_{}",
                        table.name,
                        columns.join("_")
                    ))
                ),
                columns.iter().map(|column| quote_identifier(engine, column)).collect::<Vec<_>>().join(", "),
                quote_identifier(engine, &referenced.name),
                references.iter().map(|column| quote_identifier(engine, column)).collect::<Vec<_>>().join(", "),
                sql_action(&key.on_delete),
                sql_action(&key.on_update),
            ));
        }
    }

    // Drops go last so nothing is removed while a new object still depends on it.
    for change in changes
        .iter()
        .filter(|change| change.kind == DatabaseChangeKind::Drop)
    {
        let Some(object_id) = change.object_id.as_deref() else {
            continue;
        };
        match before
            .objects
            .iter()
            .find(|object| object.meta().identity.id == object_id)
        {
            Some(DatabaseObject::Table(table)) => statements.push(format!(
                "DROP TABLE {};",
                quote_identifier(engine, &table.name)
            )),
            Some(DatabaseObject::Column(column)) => {
                if let Some(table) = before_index.tables.get(column.table_id.as_str()) {
                    statements.push(format!(
                        "ALTER TABLE {} DROP COLUMN {};",
                        quote_identifier(engine, &table.name),
                        quote_identifier(engine, &column.name)
                    ));
                }
            }
            Some(DatabaseObject::Index(declared)) => statements.push(format!(
                "DROP INDEX {};",
                quote_identifier(engine, &declared.name)
            )),
            _ => {}
        }
    }

    statements.dedup();
    statements.join("\n")
}

fn create_table_statement(
    engine: &DatabaseEngine,
    table: &crate::models::DatabaseTable,
    index: &GraphIndex<'_>,
) -> String {
    let mut parts: Vec<String> = index
        .columns_of(&table.meta.identity.id)
        .iter()
        .map(|column| format!("  {}", column_definition(engine, column)))
        .collect();
    if let Some(key) = index.primary_key(table) {
        let columns = index.column_names(&key.column_ids);
        if !columns.is_empty() {
            parts.push(format!(
                "  PRIMARY KEY ({})",
                columns
                    .iter()
                    .map(|column| quote_identifier(engine, column))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
    }
    for constraint in index.unique_constraints(table) {
        let columns = index.column_names(&constraint.column_ids);
        if !columns.is_empty() {
            parts.push(format!(
                "  UNIQUE ({})",
                columns
                    .iter()
                    .map(|column| quote_identifier(engine, column))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
    }
    format!(
        "CREATE TABLE {} (\n{}\n);",
        quote_identifier(engine, &table.name),
        parts.join(",\n")
    )
}

fn column_definition(engine: &DatabaseEngine, column: &DatabaseColumn) -> String {
    let mut definition = format!(
        "{} {}",
        quote_identifier(engine, &column.name),
        column.native_type
    );
    if !column.nullable {
        definition.push_str(" NOT NULL");
    }
    if let Some(default) = &column.default {
        definition.push_str(&format!(" DEFAULT {}", default.normalized));
    }
    definition
}

fn quote_identifier(engine: &DatabaseEngine, value: &str) -> String {
    match engine {
        DatabaseEngine::Mysql | DatabaseEngine::Mariadb => format!("`{value}`"),
        _ => format!("\"{value}\""),
    }
}

fn sql_action(action: &ReferentialAction) -> &'static str {
    match action {
        ReferentialAction::Cascade => "CASCADE",
        ReferentialAction::SetNull => "SET NULL",
        ReferentialAction::SetDefault => "SET DEFAULT",
        ReferentialAction::Restrict => "RESTRICT",
        ReferentialAction::NoAction => "NO ACTION",
    }
}

fn prisma_action(action: &ReferentialAction) -> &'static str {
    match action {
        ReferentialAction::Cascade => "Cascade",
        ReferentialAction::SetNull => "SetNull",
        ReferentialAction::SetDefault => "SetDefault",
        ReferentialAction::Restrict => "Restrict",
        ReferentialAction::NoAction => "NoAction",
    }
}

fn qualified_or_name(table: &crate::models::DatabaseTable) -> String {
    table
        .mapped_name
        .clone()
        .unwrap_or_else(|| table.name.clone())
}

fn pascal_case(value: &str) -> String {
    value
        .split(['_', '-', ' '])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut characters = part.chars();
            match characters.next() {
                Some(first) => first.to_uppercase().collect::<String>() + characters.as_str(),
                None => String::new(),
            }
        })
        .collect()
}

fn camel_case(value: &str) -> String {
    let pascal = pascal_case(value);
    let mut characters = pascal.chars();
    match characters.next() {
        Some(first) => first.to_lowercase().collect::<String>() + characters.as_str(),
        None => String::new(),
    }
}

/// Random-access view over a graph, so generation never rescans the object list per lookup.
pub struct GraphIndex<'a> {
    pub tables: HashMap<&'a str, &'a crate::models::DatabaseTable>,
    columns: HashMap<&'a str, &'a DatabaseColumn>,
    orm_symbols: HashMap<&'a str, &'a str>,
    graph: &'a ExtractedDatabaseGraph,
}

impl<'a> GraphIndex<'a> {
    pub fn new(graph: &'a ExtractedDatabaseGraph) -> Self {
        let mut tables = HashMap::new();
        let mut columns = HashMap::new();
        let mut orm_symbols = HashMap::new();
        for object in &graph.objects {
            match object {
                DatabaseObject::Table(table) => {
                    tables.insert(table.meta.identity.id.as_str(), table);
                }
                DatabaseObject::Column(column) => {
                    columns.insert(column.meta.identity.id.as_str(), column);
                }
                DatabaseObject::OrmModel(model) => {
                    if let Some(table_id) = &model.mapped_table_id {
                        orm_symbols.insert(table_id.as_str(), model.symbol.as_str());
                    }
                }
                _ => {}
            }
        }
        Self {
            tables,
            columns,
            orm_symbols,
            graph,
        }
    }

    pub fn orm_symbol(&self, table_id: &str) -> Option<String> {
        self.orm_symbols
            .get(table_id)
            .map(|value| (*value).to_owned())
    }

    pub fn table_by_qualified(&self, qualified: &str) -> Option<&'a crate::models::DatabaseTable> {
        self.tables
            .values()
            .find(|table| table.meta.identity.qualified_name == qualified)
            .copied()
    }

    pub fn columns_of(&self, table_id: &str) -> Vec<&'a DatabaseColumn> {
        let mut columns: Vec<&DatabaseColumn> = self
            .graph
            .objects
            .iter()
            .filter_map(|object| match object {
                DatabaseObject::Column(column) if column.table_id == table_id => Some(column),
                _ => None,
            })
            .collect();
        columns.sort_by_key(|column| column.ordinal);
        columns
    }

    pub fn column_names(&self, ids: &[String]) -> Vec<String> {
        ids.iter()
            .filter_map(|id| {
                self.columns
                    .get(id.as_str())
                    .map(|column| column.name.clone())
            })
            .collect()
    }

    pub fn primary_key(&self, table: &crate::models::DatabaseTable) -> Option<&'a PrimaryKey> {
        self.graph.objects.iter().find_map(|object| match object {
            DatabaseObject::PrimaryKey(key) if key.table_id == table.meta.identity.id => Some(key),
            _ => None,
        })
    }

    pub fn foreign_keys(&self, table: &crate::models::DatabaseTable) -> Vec<&'a ForeignKey> {
        self.graph
            .objects
            .iter()
            .filter_map(|object| match object {
                DatabaseObject::ForeignKey(key) if key.table_id == table.meta.identity.id => {
                    Some(key)
                }
                _ => None,
            })
            .collect()
    }

    pub fn unique_constraints(
        &self,
        table: &crate::models::DatabaseTable,
    ) -> Vec<&'a UniqueConstraint> {
        self.graph
            .objects
            .iter()
            .filter_map(|object| match object {
                DatabaseObject::UniqueConstraint(constraint)
                    if constraint.table_id == table.meta.identity.id =>
                {
                    Some(constraint)
                }
                _ => None,
            })
            .collect()
    }

    pub fn indexes(&self, table: &crate::models::DatabaseTable) -> Vec<&'a Index> {
        self.graph
            .objects
            .iter()
            .filter_map(|object| match object {
                DatabaseObject::Index(index) if index.table_id == table.meta.identity.id => {
                    Some(index)
                }
                _ => None,
            })
            .collect()
    }
}
