# One-shot DB seed: runs the team's ProcessPokeData seeder from
# scripts/pokedb-setup.zip. It connects to the hardcoded 127.0.0.1:27017, so
# compose runs it inside the mongo service's network namespace.
FROM alpine AS unzip
COPY scripts/pokedb-setup.zip /tmp/
RUN mkdir /seed && unzip /tmp/pokedb-setup.zip -d /seed

FROM mcr.microsoft.com/dotnet/runtime:9.0
COPY --from=unzip /seed /seed
# the seeder reads pokemon_utf8.csv from the working directory
WORKDIR /seed/net9.0
CMD ["dotnet", "ProcessPokeData.dll"]
